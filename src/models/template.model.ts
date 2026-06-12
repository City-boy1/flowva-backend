import mongoose, { Document, Schema } from 'mongoose';

export type TemplateStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ITemplate extends Document {
  creatorId: string;          // Prisma User.id (cuid)
  title: string;
  description: string;
  category: string;
  tags: string[];
  software: string[];
  price: number;
  currency: string;
  fileUrl: string;            // Cloudinary secure_url
  filePublicId: string;       // Cloudinary public_id (for deletion)
  fileType: 'video' | 'zip' | 'image' | 'pdf';
  fileSizeBytes: number;
  previewUrl: string | null;  // Cloudinary thumbnail (video first-frame) or null
previewVideoUrl: string | null;  // 8-second preview clip — safe to expose publicly
previewPublicId: string | null;
  status: TemplateStatus;

approvedBy?: string | null;
approvedAt?: Date | null;

rejectedBy?: string | null;
rejectedAt?: Date | null;

rejectionReason: string | null;

downloadCount: number;
  purchaseCount: number;
  salesCount: number;
  rating: number;
  ratingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const TemplateSchema = new Schema<ITemplate>(
  {
    creatorId:        { type: String, required: true, index: true },
    title:            { type: String, required: true, trim: true, maxlength: 150 },
    description:      { type: String, required: true, maxlength: 2000 },
    category:         { type: String, required: true, index: true },
    tags:             { type: [String], default: [] },
    software:         { type: [String], default: [] },
    price:            { type: Number, required: true, min: 0 },
    currency:         { type: String, default: 'USD' },
    fileUrl:          { type: String, required: true },
    filePublicId:     { type: String, required: true },
    fileType:         { type: String, enum: ['video', 'zip', 'image', 'pdf'], required: true },
    fileSizeBytes:    { type: Number, required: true },
    previewUrl:       { type: String, default: null },
    previewVideoUrl:  { type: String, default: null },
    previewPublicId:  { type: String, default: null },
   status: {
  type: String,
  enum: ['PENDING', 'APPROVED', 'REJECTED'],
  default: 'PENDING',
  index: true,
},

approvedBy: {
  type: String,
  default: null,
},

approvedAt: {
  type: Date,
  default: null,
},

rejectedBy: {
  type: String,
  default: null,
},

rejectedAt: {
  type: Date,
  default: null,
},

rejectionReason: {
  type: String,
  default: null,
},

downloadCount: {
  type: Number,
  default: 0,
},
    purchaseCount:    { type: Number, default: 0 },
    salesCount:    { type: Number, default: 0 },
    rating:        { type: Number, default: 0 },
    ratingCount:   { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for public listing queries
TemplateSchema.index({ status: 1, category: 1, createdAt: -1 });
TemplateSchema.index({ status: 1, price: 1 });
TemplateSchema.index({ title: 'text', description: 'text', tags: 'text' });
TemplateSchema.index({ title: 'text', description: 'text' });
TemplateSchema.index({ status: 1, createdAt: -1 });   // main marketplace query
TemplateSchema.index({ status: 1, category: 1 });      // category filter
TemplateSchema.index({ creatorId: 1, status: 1 });     // creator dashboard
export const Template = mongoose.model<ITemplate>('Template', TemplateSchema);