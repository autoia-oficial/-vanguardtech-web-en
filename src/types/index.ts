export interface Lead {
  id: number;
  business_name: string;
  category?: string;
  city?: string;
  province?: string;
  email?: string;
  phone?: string;
  website?: string;
  status: 'NEW' | 'QUALIFIED' | 'AUDIT_READY' | 'AUDITED' | 'DEMO_READY' | 'CONTACTED' | 'REPLIED' | 'DEMO_SENT' | 'INTERESTED' | 'MEETING' | 'ACCEPTED' | 'PAID' | 'PROJECT' | 'LIVE' | 'LOST' | 'DO_NOT_CONTACT';
  priority: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  created_at: Date;
  updated_at: Date;
  last_contact_at?: Date;
  next_follow_up_at?: Date;
  notes?: string;
}

export interface Audit {
  id: number;
  lead_id: number;
  overall_status: 'PASS' | 'WARNING' | 'FAIL' | 'NOT_VERIFIED';
  overall_score: number;
  created_at: Date;
  updated_at: Date;
}

export interface AuditCheck {
  id: number;
  audit_id: number;
  check_number: number;
  check_name: string;
  status: 'PASS' | 'WARNING' | 'FAIL' | 'NOT_VERIFIED';
  score: number;
  evidence?: string;
  problem?: string;
  impact?: string;
  priority?: string;
  checked_at?: Date;
}

export interface Email {
  id: number;
  campaign_id?: number;
  lead_id: number;
  contact_id: number;
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'OPENED' | 'CLICKED' | 'REPLIED';
  sent_at?: Date;
  opened_at?: Date;
  clicked_at?: Date;
  replied_at?: Date;
  created_at: Date;
}

export interface Campaign {
  id: number;
  name: string;
  description?: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  daily_limit: number;
  created_at: Date;
  updated_at: Date;
}

export interface DashboardStats {
  total_leads: number;
  new_leads: number;
  audited: number;
  priority_leads: number;
  contacted: number;
  replies: number;
  demos: number;
  meetings: number;
  accepted: number;
  paid: number;
  live: number;
  emails_today: number;
  follow_ups_today: number;
  automation_errors: number;
}

export interface Activity {
  id: number;
  lead_id: number;
  activity_type: string;
  description?: string;
  created_at: Date;
}
