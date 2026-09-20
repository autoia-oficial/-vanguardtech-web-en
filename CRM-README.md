# Vanguard CRM - Autonomous Sales System

A complete, production-ready sales automation platform for Vanguard Tech. Built with Next.js, TypeScript, PostgreSQL, and deployed on Vercel.

## 🎯 Features

### Core CRM
- **Lead Management**: Create, track, and manage leads with detailed information
- **Lead Scoring**: Automatic scoring based on audit results and data quality
- **Pipeline Management**: 16-stage pipeline (NEW → LIVE)
- **Activity Timeline**: Complete activity history for every lead
- **Custom Fields**: Extensible lead data structure

### Audits & Scoring
- **13 Comprehensive Checks**:
  1. Mobile Responsiveness
  2. HTTPS/Security
  3. Performance
  4. Visual Structure
  5. Call-to-Action (CTA)
  6. Click-to-Call Functionality
  7. Opening Hours
  8. Services Information
  9. Location/Maps
  10. Contactability
  11. Basic SEO
  12. Images & Content Quality
  13. Local Consistency (Google My Business, etc.)

- **Automatic Scoring**: Combined with lead data quality to produce actionable scores

### Email Management
- **Campaign Management**: Create and manage email campaigns
- **Email Accounts**: Configure multiple sender accounts with daily limits
- **Email Queue**: Automatic email sending with rate limiting
- **Email Events**: Track opens, clicks, replies, bounces
- **Suppression List**: Automatically avoid sending to unresponsive addresses
- **Do-Not-Contact List**: Respect user preferences

### Automations & Workflows
- **Follow-up Sequences**: Automated multi-step email sequences
- **Lead Discovery**: Background discovery of new business opportunities
- **Duplicate Detection**: Automatic detection of duplicate leads
- **Email Queue Processing**: Scheduled email sending with safety limits
- **Error Recovery**: Automatic retry logic for failed operations

### Dashboard & Analytics
- **Real-time Stats**: Total leads, new leads, audited, contacts, replies, etc.
- **Activity Feed**: Recent activities and changes
- **Lead Tables**: Filterable, sortable lead views
- **Email Tracking**: Daily email stats
- **Automation Status**: View automation runs and errors

## 🏗️ Architecture

### Technology Stack
- **Frontend**: React 18, Next.js 15, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components
- **Database**: PostgreSQL with Neon
- **ORM**: Drizzle ORM
- **Deployment**: Vercel
- **API**: RESTful with Next.js API Routes
- **Scheduled Jobs**: Vercel Cron Jobs

### Database Schema
Complete relational schema with 20+ tables:
- `users` - User accounts and permissions
- `leads` - Business leads
- `audits` - Website audits
- `audit_checks` - Individual audit check results
- `contacts` - Contact persons
- `email_accounts` - Configured sender accounts
- `campaigns` - Email campaigns
- `emails` - Sent emails with tracking
- `email_events` - Email open/click/bounce events
- `follow_ups` - Automated follow-up sequences
- `demos` - Demo/meeting scheduling
- `activities` - Activity timeline
- `automations` - Automation configurations
- `automation_runs` - Execution history
- `errors` - Error log for recovery
- `suppression_list` - Do-not-contact addresses
- `settings` - System configuration

### Lead Pipeline Stages
1. **NEW** - Just discovered
2. **QUALIFIED** - Data verified
3. **AUDIT_READY** - Ready for audit
4. **AUDITED** - Website audited
5. **DEMO_READY** - Demo scheduled
6. **CONTACTED** - Initial contact made
7. **REPLIED** - Lead responded
8. **DEMO_SENT** - Demo materials sent
9. **INTERESTED** - Showed interest
10. **MEETING** - Meeting scheduled
11. **ACCEPTED** - Proposal accepted
12. **PAID** - Closed and paid
13. **PROJECT** - Project in progress
14. **LIVE** - Project live
15. **LOST** - Lost opportunity
16. **DO_NOT_CONTACT** - No further contact

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm/yarn
- PostgreSQL 12+ (local or via Neon)
- Git

### Local Development Setup

1. **Clone and install**:
```bash
cd vanguard-crm
npm install
```

2. **Set up PostgreSQL locally**:
```bash
# macOS with Homebrew
brew install postgresql@15
brew services start postgresql@15

# Create database
createdb vanguard_crm_dev
```

3. **Configure environment**:
```bash
# Copy example env file
cp .env.local.example .env.local

# Edit .env.local and set DATABASE_URL
```

4. **Run migrations**:
```bash
npm run db:push
```

5. **Start development server**:
```bash
npm run dev
```

Visit `http://localhost:3000` to see the CRM dashboard.

## 📝 Database Migrations

Generate schema:
```bash
npm run db:generate
```

Push schema to database:
```bash
npm run db:push
```

View database with Drizzle Studio:
```bash
npm run db:studio
```

## 🔌 API Routes

### Leads
- `GET /api/leads` - List leads with pagination
- `POST /api/leads` - Create new lead
- `GET /api/leads/[id]` - Get lead details
- `PATCH /api/leads/[id]` - Update lead
- `DELETE /api/leads/[id]` - Delete lead

### Audits
- `GET /api/audits` - List audits
- `POST /api/audits` - Create audit with checks
- `GET /api/audits?lead_id=X` - Get lead audit

### Emails
- `GET /api/emails` - List emails
- `POST /api/emails` - Create email
- `GET /api/emails?lead_id=X` - Get lead emails

### Campaigns
- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign

### Automations
- `GET /api/automations` - List automations
- `POST /api/automations` - Create automation

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics

### Cron Jobs
- `GET /api/cron/email-queue` - Process email queue (every 5 minutes)
- `GET /api/cron/follow-ups` - Process follow-ups (daily at 9 AM)
- `GET /api/cron/leads-discovery` - Discover new leads (every 6 hours)
- `GET /api/cron/duplicate-detection` - Find duplicates (weekly Sunday 2 AM)

## ⚙️ Configuration

### Email Configuration
Configure email accounts in the CRM dashboard or via API:
```json
{
  "email": "sales@vanguardtech.com",
  "name": "Vanguard Sales",
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_user": "your-email@gmail.com",
  "smtp_password": "app-password",
  "daily_limit": 100,
  "is_active": true
}
```

### Campaign Configuration
Create campaigns with target filters:
```json
{
  "name": "Restaurants Campaign Q4",
  "description": "Target restaurants without websites",
  "target_filter": {
    "category": "RESTAURANTS",
    "has_website": false,
    "priority": ["high", "critical"]
  },
  "email_account_id": 1,
  "daily_limit": 50,
  "status": "DRAFT"
}
```

### Email Limits
- **Daily Limit**: Per email account (default 100)
- **Hourly Limit**: Implicit through queue processing
- **Suppression List**: Automatic email blocking
- **Do-Not-Contact**: Lead status prevents any outreach
- **Idempotency**: Same email not sent twice within 24 hours

## 🧪 Testing

Run tests:
```bash
npm test
```

Run tests with UI:
```bash
npm run test:ui
```

Type checking:
```bash
npm run type-check
```

## 🔧 Building

Build for production:
```bash
npm run build
```

Start production server:
```bash
npm start
```

## 📦 Deployment on Vercel

### 1. Connect Repository
```bash
vercel link
```

### 2. Set Environment Variables
In Vercel dashboard or CLI:
```bash
vercel env add DATABASE_URL
vercel env add CRON_SECRET
```

### 3. Configure PostgreSQL with Neon

1. Go to https://neon.tech
2. Create new project
3. Copy connection string
4. Add to Vercel as DATABASE_URL

### 4. Deploy
```bash
vercel deploy --prod
```

## 🔐 Security Considerations

- **API Authentication**: Cron jobs use bearer token (CRON_SECRET)
- **Email Validation**: Suppression list prevents bounces
- **Rate Limiting**: Daily and hourly email limits
- **Data Privacy**: No fake data in production, only real leads
- **Audit Trail**: All actions logged in activities table
- **Environment Variables**: Never commit secrets to git

## 📊 Scoring Algorithm

Lead score is calculated from:
1. **Base Score**: 20 points
2. **Contact Data**: Up to 30 points (email +10, phone +10, website +10)
3. **Website Quality**: Up to 20 points (based on audit results)
4. **Audit Completion**: 15 points (if audited)
5. **Priority Boost**: Up to 15 points (critical +15, high +10, medium +5)

**Total**: 0-100 points

## 🛠️ Maintenance

### Regular Tasks
- **Monitor Errors**: Check `/api/dashboard` for unresolved errors
- **Cleanup Bounced Emails**: Move to suppression list automatically
- **Archive Old Leads**: Move completed leads to history
- **Update Email Limits**: Based on delivery rates
- **Review Duplicate Leads**: Merge related leads

### Backup Strategy
- Use Neon's automated backups
- Export critical data weekly
- Keep git history clean and backed up

## 🐛 Troubleshooting

### Database Connection Issues
```bash
# Check connection string
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### Email Not Sending
1. Check email account is active
2. Verify daily limit not exceeded
3. Check suppression list
4. Review cron job logs

### Leads Not Appearing
1. Verify database connection
2. Check API response for errors
3. Clear browser cache and refresh

## 📞 Support

For issues or questions:
1. Check error logs: `GET /api/dashboard`
2. Review cron job status
3. Check database schema with Drizzle Studio
4. Examine activity timeline for specific leads

## 📄 License

Proprietary - Vanguard Tech
