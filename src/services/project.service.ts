import { ProjectContent, BidContent } from '../db/models.js';
import prisma from '../db/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { emailService } from './email.service.js';

export const projectService = {
  async create(clientId: string, data: {
    title: string; description: string; category: string;
    skills: string[]; budget: number; currency: string;
    deadline: string;
    software?: string;
    experience?: string;
    attachments?: string[];
  }) {
    const pgProject = await prisma.project.create({
      data: { clientId, budget: data.budget, status: 'PENDING',
      biddingClosesAt: new Date(data.deadline) },
    });

    const mongoProject = await ProjectContent.create({
      pgProjectId: pgProject.id,
      clientId, ...data,
      deadline: new Date(data.deadline),
    });

    await prisma.project.update({
      where: { id: pgProject.id },
      data: { mongoProjectId: mongoProject._id.toString() },
    });

    return { ...pgProject, content: mongoProject };
  },

  async list(query: { category?: string; search?: string; page?: number; limit?: number; scope?: string; userId?: string; role?: string }) {
    const filter: Record<string, any> = {};
    if (query.category) filter.category = query.category;
    if (query.search) filter.$text = { $search: query.search };

    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 50);
    const skip = (page - 1) * limit;

    const { scope } = query;
    const userId = query.userId;
    const openProjects = await prisma.project.findMany({
      where: scope === 'dashboard' && userId && query.role === 'creator'
        ? { bids: { some: { creatorId: userId } } }
        : scope === 'dashboard' && userId && query.role === 'client'
        ? { clientId: userId, status: { in: ['PENDING', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED'] } }
                : scope === 'admin' ? {}
        : { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      skip, take: limit,
    });

    console.log('FOUND PROJECTS:', openProjects.length, openProjects.map(p => ({ id: p.id, status: p.status, clientId: p.clientId })));
    const pgIds = openProjects.map((p) => p.id);
    const contents = await ProjectContent.find({ pgProjectId: { $in: pgIds } }).lean();
    const contentMap = Object.fromEntries(contents.map((c) => [c.pgProjectId, c]));

    // Enrich with client name and real rating
    const clientIds = [...new Set(openProjects.map(p => p.clientId))];
    const clients = await prisma.user.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true },
    });
    const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]));

    const ratings = await prisma.rating.groupBy({
      by: ['creatorId'],
      where: { creatorId: { in: clientIds } },
      _avg: { score: true },
      _count: { score: true },
    });
    const ratingMap = Object.fromEntries(
      ratings.map(r => [r.creatorId, { avg: r._avg.score ?? 0, count: r._count.score }])
    );

    return openProjects.map((p) => ({
      ...p,
      content: contentMap[p.id] || null,
      clientName: clientMap[p.clientId] ?? 'Client',
      clientRating: ratingMap[p.clientId]?.avg ?? 0,
      clientRatingCount: ratingMap[p.clientId]?.count ?? 0,
    }));
  },

  async getById(id: string) {
    const pg = await prisma.project.findUnique({ where: { id }, include: { bids: true } });
    if (!pg) throw new AppError('Project not found', 404);
    const content = await ProjectContent.findOne({ pgProjectId: id }).lean();
    return { ...pg, content };
  },

  async submitBid(projectId: string, creatorId: string, data: {
    amount: number; proposal: string; deliveryDays: number; sampleUrls?: string[];
  }) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.status !== 'OPEN') throw new AppError('Project not open for bidding', 400);

    const existing = await prisma.bid.findFirst({ where: { projectId, creatorId } });
    if (existing) throw new AppError('You already submitted a bid', 409);

    const pgBid = await prisma.bid.create({
      data: { projectId, creatorId, amount: data.amount, status: 'PENDING' },
    });

    await BidContent.create({
      pgBidId: pgBid.id,
      pgProjectId: projectId,
      creatorId,
      proposal: data.proposal,
      deliveryDays: data.deliveryDays,
      sampleUrls: data.sampleUrls || [],
    });

    return pgBid;
  },

  async getBids(projectId: string, requesterId: string, role: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError('Project not found', 404);
    if (project.clientId !== requesterId && role !== 'ADMIN') throw new AppError('Forbidden', 403);

    const pgBids = await prisma.bid.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    const bidIds = pgBids.map((b) => b.id);
    const contents = await BidContent.find({ pgBidId: { $in: bidIds } }).lean();
    const contentMap = Object.fromEntries(contents.map((c) => [c.pgBidId, c]));

    return pgBids.map((b) => ({ ...b, content: contentMap[b.id] || null }));
  },

  async acceptBid(projectId: string, bidId: string, clientId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.clientId !== clientId) throw new AppError('Forbidden', 403);
    if (project.status !== 'OPEN') throw new AppError('Project is not open', 400);

    const bid = await prisma.bid.findUnique({ where: { id: bidId } });
    if (!bid || bid.projectId !== projectId) throw new AppError('Bid not found', 404);

    await prisma.$transaction([
      prisma.project.update({
        where: { id: projectId },
        data: { status: 'IN_PROGRESS', acceptedBidId: bidId },
      }),
      prisma.bid.update({ where: { id: bidId }, data: { status: 'ACCEPTED' } }),
      prisma.bid.updateMany({
        where: { projectId, id: { not: bidId } },
        data: { status: 'REJECTED' },
      }),
    ]);

    const creator = await prisma.user.findUnique({ where: { id: bid.creatorId } });
    const content = await ProjectContent.findOne({ pgProjectId: projectId }).lean();
    if (creator && content) await emailService.bidAccepted(creator.email, content.title);

    return bid;
  },

  async rejectBid(projectId: string, bidId: string, clientId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.clientId !== clientId) throw new AppError('Forbidden', 403);
    await prisma.bid.updateMany({
      where: { id: bidId, projectId },
      data: { status: 'REJECTED' },
    });
  },

  async withdrawBid(projectId: string, bidId: string, creatorId: string) {
    const bid = await prisma.bid.findFirst({ where: { id: bidId, projectId, creatorId } });
    if (!bid) throw new AppError('Bid not found', 404);
    if (bid.status !== 'PENDING') throw new AppError('Only pending bids can be withdrawn', 400);
    await prisma.bid.update({ where: { id: bidId }, data: { status: 'WITHDRAWN' } });
  },

  async approve(projectId: string) {
    return prisma.project.update({
      where: { id: projectId },
      data: { status: 'OPEN' },
    });
  },

  async deliver(projectId: string, creatorId: string, deliveryNote: string, fileUrl: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { bids: { where: { status: 'ACCEPTED' } } },
    });
    if (!project) throw new AppError('Project not found', 404);
    if (project.status !== 'IN_PROGRESS') throw new AppError('Project is not in progress', 400);
    const acceptedBid = project.bids[0];
    if (!acceptedBid || acceptedBid.creatorId !== creatorId) throw new AppError('Not authorised', 403);

    await prisma.order.updateMany({
      where: { mongoBidId: acceptedBid.id, status: 'PAID' },
      data: { status: 'DELIVERED', deliveryNote: `${deliveryNote}||${fileUrl}` },
    });
    return prisma.project.update({
      where: { id: projectId },
      data: { status: 'IN_PROGRESS' }, // stays IN_PROGRESS until client approves
    });
  },

  async approveDelivery(projectId: string, clientId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { bids: { where: { status: 'ACCEPTED' } } },
    });
    if (!project || project.clientId !== clientId) throw new AppError('Forbidden', 403);
    const acceptedBid = project.bids[0];
    if (!acceptedBid) throw new AppError('No accepted bid', 400);

    const order = await prisma.order.findFirst({
      where: { mongoBidId: acceptedBid.id, status: 'DELIVERED' },
      include: { creator: true },
    });
    if (!order) throw new AppError('No delivered order found', 400);

    const commissionRate = order.creator.isEarlyAdopter
      ? parseFloat(process.env.EARLY_ADOPTER_COMMISSION_RATE || '0.10')
      : parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.30');
    const creatorEarning = Number((order.amount * (1 - commissionRate)).toFixed(2));

    // NOTE: Helio already split the payment on-chain at checkout.
    // CreatorWallet is a display-only earnings tracker — we update it here
    // so the dashboard shows accurate lifetime earnings.
    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
      prisma.project.update({ where: { id: projectId }, data: { status: 'COMPLETED' } }),
      prisma.escrow.updateMany({
        where: { orderId: order.id, status: 'HELD' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      }),
      prisma.creatorWallet.upsert({
        where: { userId: order.creatorId },
        create: {
          userId: order.creatorId,
          totalEarned: creatorEarning,
          pending: 0,
        },
        update: {
          totalEarned: { increment: creatorEarning },
          pending: { decrement: creatorEarning }, // move from pending to confirmed earned
        },
      }),
    ]);
    return order;
  },

  async requestRevision(projectId: string, clientId: string, note: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { bids: { where: { status: 'ACCEPTED' } } },
    });
    if (!project || project.clientId !== clientId) throw new AppError('Forbidden', 403);
    const acceptedBid = project.bids[0];
    const order = await prisma.order.findFirst({
      where: { mongoBidId: acceptedBid?.id, status: 'DELIVERED' },
    });
    if (!order) throw new AppError('No delivered order to revise', 400);
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'REVISION_REQUESTED', deliveryNote: note, revisionCount: { increment: 1 } },
    });
    return project;
  },

  async openDispute(projectId: string, userId: string, reason: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new AppError('Project not found', 404);
    if (project.clientId !== userId && project.status !== 'IN_PROGRESS') throw new AppError('Forbidden', 403);
    const order = await prisma.order.findFirst({
      where: { status: { in: ['PAID', 'DELIVERED', 'REVISION_REQUESTED'] } },
    });
    if (!order) throw new AppError('No active order to dispute', 400);
    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: { status: 'DISPUTED', deliveryNote: reason } }),
      prisma.project.update({ where: { id: projectId }, data: { status: 'DISPUTED' } }),
      prisma.escrow.updateMany({ where: { orderId: order.id }, data: { status: 'DISPUTED' } }),
    ]);
    return project;
  },

  async fundEscrow(data: {
    projectId: string;
    bidId: string;
    amount: number;
    method: string;
    reference: string;
    clientId: string;
  }) {
    const { projectId, bidId, amount, method, reference, clientId } = data;

    // Validate project + bid belong together and client owns the project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { bids: { where: { id: bidId } } },
    });
    if (!project) throw new AppError('Project not found', 404);
    if (project.clientId !== clientId) throw new AppError('Forbidden', 403);
    if (project.status !== 'IN_PROGRESS') throw new AppError('Project must be IN_PROGRESS (bid accepted) before funding escrow', 400);

    const bid = project.bids[0];
    if (!bid) throw new AppError('Bid not found on this project', 404);
    if (bid.status !== 'ACCEPTED') throw new AppError('Bid is not accepted', 400);

    const creator = await prisma.user.findUnique({ where: { id: bid.creatorId } });
    if (!creator) throw new AppError('Creator not found', 404);

    // Idempotency: if order + escrow already exist for this bid, return existing
    const existingOrder = await prisma.order.findFirst({
      where: { mongoBidId: bidId },
      include: { escrow: true },
    });
    if (existingOrder) return { order: existingOrder, escrow: existingOrder.escrow };

    // Create Order + Payment + Escrow atomically
    const order = await prisma.order.create({
      data: {
        buyerId: clientId,
        creatorId: bid.creatorId,
        mongoBidId: bidId,
        type: 'PROJECT',
        amount,
        currency: 'USD',
        status: 'PAID',
      },
    });

    const [escrow, payment] = await prisma.$transaction([
      prisma.escrow.create({
        data: {
          orderId: order.id,
          amount,
          currency: 'USD',
          status: 'HELD',
        },
      }),
      prisma.payment.create({
        data: {
          orderId: order.id,
          userId: clientId,
          provider: 'HELIO',
          providerRef: reference,
          amount,
          currency: 'USD',
          status: 'SUCCESS',
          metadata: { method },
        },
      }),
    ]);

    // Notify creator to begin work
    await prisma.notification.create({
      data: {
        userId: bid.creatorId,
        type: 'ESCROW_FUNDED',
        title: 'Payment received — you can start work',
        message: `The client has funded escrow for the project. Deliver by the agreed deadline.`,
      },
    });

    return { order, escrow, payment };
  },
};