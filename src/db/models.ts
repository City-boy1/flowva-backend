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
  software?: string;
  experience?: string;
  attachments: { url: string; publicId: string; name: string }[];  createdAt: Date;
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
  software: { type: String, default: '' },
  experience: { type: String, default: '' },
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
  youtubeId?: string;
  youtubeUrl?: string;
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
  videoUrl: { type: String, default: '' },
  videoPublicId: { type: String, default: '' },
  youtubeId: { type: String, default: '' },
  youtubeUrl: { type: String, default: '' },
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

export interface IJob extends Document {
  pgJobId: string;
  title: string;
  company: string;
  description: string;
  fields: string[];
  field: string;
  location: string;
  city?: string;
  salary?: { min?: number; max?: number; period: string; currency: string };
  website?: string;
  postedBy: string;
  jobType: string;
}

const JobSchema = new Schema<IJob>({
  pgJobId:     { type: String, required: true, unique: true },
  title:       { type: String, required: true },
  company:     { type: String, required: true },
  description: { type: String, required: true },
  fields:      [String],
  field:       { type: String, default: '' },
  location:    { type: String, required: true },
  city:        { type: String, default: '' },
  salary:      {
    min:      Number,
    max:      Number,
    period:   { type: String, default: 'year' },
    currency: { type: String, default: 'USD' },
  },
  website:  { type: String, default: '' },
  postedBy: { type: String, required: true },
  jobType:  { type: String, required: true },
}, { timestamps: true });

export const JobContent = mongoose.model<IJob>('JobContent', JobSchema);

export interface IJobApplication extends Document {
  pgApplicationId: string;
  pgJobId: string;
  userId: string;
  coverLetter?: string;
  portfolioUrl?: string;
  field?: string;
  appliedAt: Date;
}

const JobApplicationSchema = new Schema<IJobApplication>({
  pgApplicationId: { type: String, required: true, unique: true },
  pgJobId:         { type: String, required: true, index: true },
  userId:          { type: String, required: true, index: true },
  coverLetter:     { type: String, default: '' },
  portfolioUrl:    { type: String, default: '' },
  field:           { type: String, default: '' },
  appliedAt:       { type: Date, default: Date.now },
}, { timestamps: true });

export const JobApplicationContent = mongoose.model<IJobApplication>('JobApplicationContent', JobApplicationSchema);