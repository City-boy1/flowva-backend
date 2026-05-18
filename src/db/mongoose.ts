import mongoose, { Schema, Document, Model } from 'mongoose';
import logger from '../utils/logger.js';

// ── Connection ─────────────────────────────────────────
export async function connectMongo(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not defined in environment variables');

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
  });
  logger.info('MongoDB connected');
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}

// ══════════════════════════════════════════════════════
// USER MODEL
// ══════════════════════════════════════════════════════
export interface IUser extends Document {
  name:            string;
  email:           string;
  password:        string;
  role:            'buyer' | 'creator' | 'admin';
  avatar?:         string;
  bio?:            string;
  tags?:           string[];
  refreshToken?:   string;
  stripeAccountId?: string;
  payoutMethod?:   string;
  payoutAccount?:  string;
  payoutName?:     string;
  isVerified:      boolean;
  totalSales:      number;
  totalRevenue:    number;
  createdAt:       Date;
}

const UserSchema = new Schema<IUser>({
  name:            { type: String, required: true, trim: true, maxlength: 100 },
  email:           { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:        { type: String, required: true, select: false },
  role:            { type: String, enum: ['buyer', 'creator', 'admin'], default: 'buyer' },
  avatar:          { type: String },
  bio:             { type: String, maxlength: 500 },
  tags:            [{ type: String }],
  refreshToken:    { type: String, select: false },
  stripeAccountId: { type: String },
  payoutMethod:    { type: String },
  payoutAccount:   { type: String },
  payoutName:      { type: String },
  isVerified:      { type: Boolean, default: false },
  totalSales:      { type: Number, default: 0 },
  totalRevenue:    { type: Number, default: 0 },
}, { timestamps: true });

// Never return password or refreshToken in queries
UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.refreshToken;
    delete ret.__v;
    return ret;
  },
});

export const User: Model<IUser> =
  mongoose.models.User ?? mongoose.model<IUser>('User', UserSchema);

// ══════════════════════════════════════════════════════
// TEMPLATE MODEL
// ══════════════════════════════════════════════════════
export interface ITemplate extends Document {
  title:        string;
  description:  string;
  category:     string;
  price:        number;
  software?:    string;
  creator:      mongoose.Types.ObjectId;
  creatorName:  string;
  thumbnailUrl: string;
  previewUrl?:  string;   // Vimeo embed URL
  downloadUrl:  string;   // Cloudinary secure URL
  tags?:        string[];
  rating:       number;
  ratingCount:  number;
  sales:        number;
  isPublished:  boolean;
  isTrending:   boolean;
  createdAt:    Date;
}

const TemplateSchema = new Schema<ITemplate>({
  title:        { type: String, required: true, trim: true, maxlength: 150 },
  description:  { type: String, required: true, maxlength: 2000 },
  category:     { type: String, required: true, lowercase: true },
  price:        { type: Number, required: true, min: 0, max: 10000 },
  software:     { type: String },
  creator:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
  creatorName:  { type: String, required: true },
  thumbnailUrl: { type: String, required: true },
  previewUrl:   { type: String },
  downloadUrl:  { type: String, required: true },
  tags:         [{ type: String }],
  rating:       { type: Number, default: 0, min: 0, max: 5 },
  ratingCount:  { type: Number, default: 0 },
  sales:        { type: Number, default: 0 },
  isPublished:  { type: Boolean, default: true },
  isTrending:   { type: Boolean, default: false },
}, { timestamps: true });

TemplateSchema.index({ category: 1, price: 1 });
TemplateSchema.index({ creator: 1 });
TemplateSchema.index({ isTrending: -1, sales: -1 });
TemplateSchema.index({ title: 'text', description: 'text' });

export const Template: Model<ITemplate> =
  mongoose.models.Template ?? mongoose.model<ITemplate>('Template', TemplateSchema);

// ══════════════════════════════════════════════════════
// MESSAGE MODEL
// ══════════════════════════════════════════════════════
export interface IMessage extends Document {
  conversationId: string;
  senderId:   mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  text:       string;
  read:       boolean;
  createdAt:  Date;
}

const MessageSchema = new Schema<IMessage>({
  conversationId: { type: String, required: true, index: true },
  senderId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text:           { type: String, required: true, maxlength: 4000 },
  read:           { type: Boolean, default: false },
}, { timestamps: true });

export const Message: Model<IMessage> =
  mongoose.models.Message ?? mongoose.model<IMessage>('Message', MessageSchema);

// ══════════════════════════════════════════════════════
// NOTIFICATION MODEL
// ══════════════════════════════════════════════════════
export interface INotification extends Document {
  userId:  mongoose.Types.ObjectId;
  icon:    string;
  text:    string;
  read:    boolean;
  link?:   string;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  userId:  { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  icon:    { type: String, default: '🔔' },
  text:    { type: String, required: true, maxlength: 300 },
  read:    { type: Boolean, default: false },
  link:    { type: String },
}, { timestamps: true });

export const Notification: Model<INotification> =
  mongoose.models.Notification ?? mongoose.model<INotification>('Notification', NotificationSchema);