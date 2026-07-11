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

    // Delivery note/file for projects currently awaiting buyer review —
    // keyed by acceptedBidId, since that's how deliver()/approveDelivery()
    // locate the relevant Order. Only fetched for projects that could
    // plausibly have one, to avoid an unnecessary query on every list call.
    const projectsAwaitingReview = openProjects.filter(
      p => p.acceptedBidId && ['IN_PROGRESS', 'DISPUTED', 'COMPLETED'].includes(p.status)
    );
    const acceptedBidIds = projectsAwaitingReview.map(p => p.acceptedBidId!);
    const relevantOrders = acceptedBidIds.length
      ? await prisma.order.findMany({
          where: { mongoBidId: { in: acceptedBidIds } },
          select: { mongoBidId: true, deliveryNote: true, status: true },
        })
      : [];
    const orderByBidId = Object.fromEntries(relevantOrders.map(o => [o.mongoBidId, o]));

    return openProjects.map((p) => ({
      ...p,
      content: contentMap[p.id] || null,
      clientName: clientMap[p.clientId] ?? 'Client',
      clientRating: ratingMap[p.clientId]?.avg ?? 0,
      clientRatingCount: ratingMap[p.clientId]?.count ?? 0,
      _deliveryNote: (p.acceptedBidId && orderByBidId[p.acceptedBidId]?.deliveryNote) ?? null,
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

    // Notification only — bidding is frequent and low-stakes per event;
    // an in-app badge is enough, no need to email the client every bid.
    await prisma.notification.create({
      data: {
        userId:  project.clientId,
        type:    'BID_SUBMITTED',
        title:   'New bid received',
        message: `A creator submitted a bid of $${data.amount.toFixed(2)} on your project.`,
      },
    }).catch(() => {});

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

    // Same payout-safety rule as template uploads — a creator can't be
    // handed paid project work with nowhere for the escrow release to go.
    const bidderPayoutSettings = await prisma.payoutSetting.findUnique({ where: { userId: bid.creatorId } });
    if (!bidderPayoutSettings?.primaryMethod) {
      throw new AppError('This creator has not set up a payout method yet and cannot be assigned paid work.', 400);
    }

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
    if (creator && content) {
      emailService.bidAccepted(creator.email, content.title).catch(() => {});
      await prisma.notification.create({
        data: {
          userId:  bid.creatorId,
          type:    'BID_ACCEPTED',
          title:   'Bid accepted',
          message: `Your bid on "${content.title}" was accepted. The project is now in progress.`,
        },
      }).catch(() => {});
    }

    return bid;
  },

  async rejectBid(projectId: string, bidId: string, clientId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.clientId !== clientId) throw new AppError('Forbidden', 403);
    const bid = await prisma.bid.findUnique({ where: { id: bidId } });
    await prisma.bid.updateMany({
      where: { id: bidId, projectId },
      data: { status: 'REJECTED' },
    });
    if (bid) {
      await prisma.notification.create({
        data: {
          userId:  bid.creatorId,
          type:    'BID_REJECTED',
          title:   'Bid not selected',
          message: `Your bid on a project was not selected by the client.`,
        },
      }).catch(() => {});
    }
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
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: { status: 'IN_PROGRESS' }, // stays IN_PROGRESS until client approves
    });

    // Both — client needs to act (approve/revise) within 7 days per the
    // email copy, so this is time-sensitive enough to warrant both.
    const client = await prisma.user.findUnique({ where: { id: project.clientId }, select: { email: true } });
    const content = await ProjectContent.findOne({ pgProjectId: projectId }).lean();
    if (client && content) {
      emailService.projectDelivered(client.email, content.title, deliveryNote).catch(() => {});
    }
    await prisma.notification.create({
      data: {
        userId:  project.clientId,
        type:    'PROJECT_DELIVERED',
        title:   'Delivery ready for review',
        message: `Your creator delivered work${content ? ` on "${content.title}"` : ''}. Review it to release payment.`,
      },
    }).catch(() => {});

    return updatedProject;
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
      : parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.20');
    const creatorEarning = Number((order.amount * (1 - commissionRate)).toFixed(2));

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
    if (acceptedBid) {
      await prisma.notification.create({
        data: {
          userId:  acceptedBid.creatorId,
          type:    'REVISION_REQUESTED',
          title:   'Revision requested',
          message: `The client requested changes: ${note}`,
        },
      }).catch(() => {});
    }
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
};