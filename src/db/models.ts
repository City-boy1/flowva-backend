import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  pgProjectId: string;
  clientId: string;
  title: string;
  description: string;
  category: string;
  skills: string[];
  budget: number;
  currency: string;
  deadline: Date;
  attachments: { url: string; publicId: string; name: string }[];
  createdAt: Date;
}

const ProjectSchema = new Schema<IProject>({
  pgProjectId: { type: String, required: true, unique: true },
  clientId: { type: String, required: true, index: true },
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, required: true, maxlength: 5000 },
  category: String,
  skills: [String],
  budget: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  deadline: Date,
  attachments: [{ url: String, publicId: String, name: String }],
}, { timestamps: true });

export const ProjectContent = mongoose.model<IProject>('ProjectContent', ProjectSchema);

export interface IBid extends Document {
  pgBidId: string;
  pgProjectId: string;
  creatorId: string;
  proposal: string;
  deliveryDays: number;
  sampleUrls: string[];
  createdAt: Date;
}

const BidSchema = new Schema<IBid>({
  pgBidId: { type: String, required: true, unique: true },
  pgProjectId: { type: String, required: true, index: true },
  creatorId: { type: String, required: true, index: true },
  proposal: { type: String, required: true, maxlength: 3000 },
  deliveryDays: { type: Number, required: true, min: 1 },
  sampleUrls: [String],
}, { timestamps: true });

export const BidContent = mongoose.model<IBid>('BidContent', BidSchema);

export interface IMessage extends Document {
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  attachments: { url: string; name: string }[];
  read: boolean;
  createdAt: Date;
  edited: boolean;
}

const MessageSchema = new Schema<IMessage>({
  conversationId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  recipientId: { type: String, required: true },
  content: { type: String, required: true, maxlength: 5000 },
  attachments: [{ url: String, name: String }],
  read: { type: Boolean, default: false },
  edited: { type: Boolean, default: false },
}, { timestamps: true });

MessageSchema.index({ conversationId: 1, createdAt: -1 });
export const Message = mongoose.model<IMessage>('Message', MessageSchema);

export interface ITutorial extends Document {
  creatorId: string;
  templateId?: string | null;
  title: string;
  description: string;
  videoUrl: string;
  videoPublicId: string;
  thumbnailUrl: string;
  duration: number;
  category: string;
  tags: string[];
  isFree: boolean;
  price: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: Date;
  approvedBy?: string;
approvedAt?: Date;

rejectedBy?: string;
rejectedAt?: Date;

rejectionReason?: string;
}

const TutorialSchema = new Schema<ITutorial>({
  creatorId: { type: String, required: true, index: true },
  templateId: { type: String, default: null, index: true },
  title: { type: String, required: true },
  description: { type: String, maxlength: 2000 },
  videoUrl: { type: String, required: true },
  videoPublicId: { type: String, required: true },
  thumbnailUrl: String,
  duration: Number,
  category: String,
  tags: [String],
  isFree: { type: Boolean, default: true },
  price: { type: Number, default: 0 },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  approvedBy: {
  type: String,
},

approvedAt: {
  type: Date,
},

rejectedBy: {
  type: String,
},

rejectedAt: {
  type: Date,
},

rejectionReason: {
  type: String,
},
}, { timestamps: true });

export const Tutorial = mongoose.model<ITutorial>('Tutorial', TutorialSchema);