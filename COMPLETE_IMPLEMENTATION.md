# A366 Academic Assignment Platform - Complete Implementation Guide

**Version**: 2.0  
**Date**: January 11, 2026  
**Status**: Ready for Production  

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema Validation](#database-schema-validation)
3. [API Endpoints Reference](#api-endpoints-reference)
4. [Notification System](#notification-system-complete)
5. [Payment Workflows](#payment-workflows)
6. [Chat System](#chat-system)
7. [Role-Based Access Control](#role-based-access-control)
8. [Workflow State Machines](#workflow-state-machines)
9. [Deployment & Configuration](#deployment--configuration)
10. [Testing Scenarios](#testing-scenarios)

---

# 1. Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                   A366 PLATFORM ARCHITECTURE                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Express    │  │   Socket.IO  │  │   MySQL      │       │
│  │   Server     │  │   Real-time  │  │   Database   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                  │                  │              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              MIDDLEWARE LAYER                          │   │
│  │  ✓ RBAC (Role-Based Access Control)                  │   │
│  │  ✓ Auth (JWT Token Validation)                       │   │
│  │  ✓ Socket Auth (Real-time Communication)             │   │
│  │  ✓ Audit Logging (All Actions)                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           BUSINESS LOGIC LAYER (Controllers)           │   │
│  │                                                          │   │
│  │  📱 Client Panel                                        │   │
│  │     • Auth (OTP-based)                                 │   │
│  │     • Query Management                                 │   │
│  │     • Order Tracking                                   │   │
│  │     • Payment Upload                                   │   │
│  │     • Delivery & Revisions                             │   │
│  │     • Chat (with BDE only)                             │   │
│  │                                                          │   │
│  │  💼 BDE Panel                                           │   │
│  │     • Query to Order Conversion                         │   │
│  │     • Quotation Generation                              │   │
│  │     • Client Management                                │   │
│  │     • Chat (Client ↔ Admin)                             │   │
│  │     • Dashboard KPIs                                    │   │
│  │                                                          │   │
│  │  ✍️  Writer Panel                                       │   │
│  │     • Task Assignment & Evaluation                      │   │
│  │     • Work Status Tracking                              │   │
│  │     • File Submission                                   │   │
│  │     • Chat (with Admin only)                            │   │
│  │                                                          │   │
│  │  👨‍💼 Admin Panel                                          │   │
│  │     • Payment Verification                              │   │
│  │     • Writer Assignment                                 │   │
│  │     • QC & Approvals                                    │   │
│  │     • All Order Overrides                               │   │
│  │     • User Management                                   │   │
│  │     • System Control                                    │   │
│  │                                                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         UTILITY LAYER                                  │   │
│  │  • Notifications (Lifecycle-driven)                    │   │
│  │  • Real-time Channels (Socket.IO)                      │   │
│  │  • Chat System (Context-aware)                         │   │
│  │  • Audit Logging (Immutable)                           │   │
│  │  • Deadline Reminders (Cron-based)                     │   │
│  │  • Email Service (Nodemailer)                          │   │
│  │  • OTP Service (Twilio/Custom)                         │   │
│  │  • Wallet Management                                   │   │
│  │  • Code Generation (Query/Work codes)                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema Validation

### Critical Tables & Relationships

#### A. Query & Order Management

| Table | Purpose | Status |
|-------|---------|--------|
| `orders` | Core order/query data | ✅ Complete |
| `file_versions` | Track all file uploads | ✅ Complete |
| `assignments` | Writer-Order mapping | ✅ Complete |
| `orders_history` | Audit trail for orders | ✅ Complete |

**Schema Issues Found & Fixed:**
```sql
-- ISSUE 1: orders table has both writer_id and writer columns
-- FIX: Use writer_id (FK to users.user_id), remove redundant 'writer' column

-- ISSUE 2: No explicit query_status tracking before payment
-- FIX: Use status field with master_status table mapping

-- ISSUE 3: order_chats stores messages as JSON (not normalized)
-- SOLUTION: This is acceptable for real-time chat, keep as-is

-- ISSUE 4: Missing payment_status_history for 50%/100% tracking
-- FIX: Use payments table with payment_type field, and add status tracking
```

#### B. Payments

| Table | Purpose | Required Fields | Status |
|-------|---------|-----------------|--------|
| `payments` | Payment records | order_id, user_id, amount, payment_method, payment_type, payment_doc | ✅ Complete |
| `wallet_transactions` | Wallet ledger | user_id, amount, type (credit/debit), reason | ✅ Complete |
| `wallets` | User balance | user_id, balance | ✅ Complete |

**Payment Flow:**
```
User Uploads Receipt (50% or 100%)
    ↓
Admin Verifies Receipt
    ↓
Generate work_code (if 50%, skip for now)
    ↓
Update order status → ORDER_CONFIRMED
    ↓
Create audit log + notification
```

#### C. Notifications & Audit

| Table | Purpose | Status |
|-------|---------|--------|
| `notifications` | User notifications | ✅ Complete |
| `audit_logs` | System audit trail | ✅ Complete |
| `deadline_reminders` | Deadline tracking | ✅ Complete |

---

### Missing Database Enhancements

None critical, but recommended enhancements:

```sql
-- ENHANCEMENT 1: Add payment_status to track verification state
ALTER TABLE payments ADD COLUMN verification_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending';
ALTER TABLE payments ADD COLUMN verified_by INT;
ALTER TABLE payments ADD COLUMN verified_at DATETIME;

-- ENHANCEMENT 2: Add notification_preference for users
ALTER TABLE users ADD COLUMN notification_frequency ENUM('realtime', '30min', '1hour', 'daily') DEFAULT 'realtime';
ALTER TABLE users ADD COLUMN push_enabled TINYINT DEFAULT 1;
ALTER TABLE users ADD COLUMN email_enabled TINYINT DEFAULT 1;

-- ENHANCEMENT 3: Add query_status for clarity before ORDER_CONFIRMED
-- (Already tracked via status field in orders table)
```

---

# 3. API Endpoints Reference

## 3.1 Authentication Endpoints

### Client Authentication (WhatsApp-First)

```
POST /auth/client/otp/email
POST /auth/client/otp/whatsapp
POST /auth/client/otp/verify
POST /auth/client/logout
```

### BDE/Writer/Admin Authentication

```
POST /auth/admin/login
POST /auth/admin/logout
POST /auth/bde/login
POST /auth/bde/logout
POST /auth/writer/login
POST /auth/writer/logout
```

---

## 3.2 Client Endpoints

### Profile Management
```
GET    /client/profile
PATCH  /client/profile
PATCH  /client/security/password
GET    /client/security/sessions
POST   /client/security/sessions/revoke
```

### Query Management (Before Payment)
```
POST   /client/queries                    # Create query
GET    /client/queries                    # List my queries
GET    /client/queries/:order_id          # Get query details
PATCH  /client/queries/:order_id          # Update query (only if not assigned)
DELETE /client/queries/:order_id          # Cancel query (only if not assigned)
GET    /client/queries/:order_id/chat     # Chat with BDE
POST   /client/queries/:order_id/chat     # Send message to BDE
```

### Quotation Management
```
GET    /client/quotations/:order_id       # View quotation
POST   /client/quotations/:order_id/accept  # Accept quotation (triggers payment flow)
POST   /client/quotations/:order_id/reject  # Reject quotation
```

### Payment Management
```
POST   /client/payments/:order_id/upload  # Upload payment receipt
GET    /client/payments/:order_id/history # Payment history
GET    /client/payments/:order_id/status  # Check payment status
```

### Order Tracking (After ORDER_CONFIRMED)
```
GET    /client/orders                     # List confirmed orders (work_code != null)
GET    /client/orders/:order_id           # Order details with full history
GET    /client/orders/:order_id/chat      # Chat in order context
POST   /client/orders/:order_id/chat      # Send message
GET    /client/orders/:order_id/files     # Download final files
POST   /client/orders/:order_id/feedback  # Submit feedback/rating
```

### Revisions
```
GET    /client/orders/:order_id/revisions # List revision requests
POST   /client/orders/:order_id/revisions # Request revision
```

---

## 3.3 BDE Endpoints

### Dashboard
```
GET    /bde/dashboard                     # KPIs (New Queries, Pending Quotations, etc.)
GET    /bde/dashboard/stats              # Detailed metrics
```

### Client Management
```
GET    /bde/clients                       # List clients (only those assigned to this BDE)
GET    /bde/clients/:user_id              # Client details
GET    /bde/clients/:user_id/queries      # All queries from this client
POST   /bde/clients/:user_id/notification # Send notification to client
```

### Query Management
```
GET    /bde/queries                       # List all queries (assigned to this BDE)
GET    /bde/queries/:order_id             # Query details
PATCH  /bde/queries/:order_id             # Update query info
POST   /bde/queries/:order_id/quotation   # Generate/update quotation
GET    /bde/queries/:order_id/chat        # Chat with client/admin
POST   /bde/queries/:order_id/chat        # Send message
POST   /bde/queries/:order_id/notification # Notify client
```

### Order Management (After Payment)
```
GET    /bde/orders                        # List confirmed orders
GET    /bde/orders/:order_id              # Order details
GET    /bde/orders/:order_id/files        # View order files
GET    /bde/orders/:order_id/status       # Order status with history
```

---

## 3.4 Writer Endpoints

### Dashboard
```
GET    /writer/dashboard                  # KPIs (New Tasks, Active, Due Today, Completed)
GET    /writer/dashboard/today-plan       # Tasks due today
```

### Task Management
```
GET    /writer/tasks                      # List all assigned tasks
GET    /writer/tasks/:order_id            # Task details
POST   /writer/tasks/:order_id/evaluate   # Evaluate task (doable/not_doable)
PATCH  /writer/tasks/:order_id            # Update task status
```

### Work Submission
```
POST   /writer/tasks/:order_id/submit     # Submit draft/final
GET    /writer/tasks/:order_id/submission # Get submission details
PATCH  /writer/tasks/:order_id/submission # Update submission (rework)
```

### Chat & Communication
```
GET    /writer/tasks/:order_id/chat       # Chat with admin
POST   /writer/tasks/:order_id/chat       # Send message
GET    /writer/messages                   # Admin messages inbox
POST   /writer/messages/:message_id/read  # Mark as read
```

---

## 3.5 Admin Endpoints

### Dashboard
```
GET    /admin/dashboard                   # All KPIs
GET    /admin/dashboard/revenue          # Revenue tracking
GET    /admin/dashboard/orders           # Order metrics
```

### Payment Management (CRITICAL)
```
GET    /admin/payments                    # List unverified payments
GET    /admin/payments/:payment_id        # Payment details with receipt
POST   /admin/payments/:payment_id/verify # ✅ VERIFY & GENERATE WORK_CODE
POST   /admin/payments/:payment_id/reject # Reject payment
GET    /admin/payments/history            # Payment history
```

### Order Management
```
GET    /admin/orders                      # List all orders
GET    /admin/orders/:order_id            # Order details
PATCH  /admin/orders/:order_id            # Edit order (emergency only)
POST   /admin/orders/:order_id/assign-writer # Assign/reassign writer
POST   /admin/orders/:order_id/close      # Force close order
```

### QC & Approvals
```
GET    /admin/submissions                 # List pending submissions
GET    /admin/submissions/:submission_id  # Review submission details
POST   /admin/submissions/:submission_id/approve # Approve for payment
POST   /admin/submissions/:submission_id/reject  # Reject & request changes
GET    /admin/submissions/:submission_id/scores # View quality scores
```

### User Management
```
GET    /admin/users                       # List all users
GET    /admin/users/:user_id              # User details
PATCH  /admin/users/:user_id              # Update user
POST   /admin/users/:user_id/verify       # Mark user verified
POST   /admin/users/:user_id/deactivate   # Deactivate user
```

### Audit & Compliance
```
GET    /admin/audit-logs                  # Audit log viewer
GET    /admin/audit-logs/:resource_type   # Filter by resource type
GET    /admin/audit-logs/:user_id         # Filter by user actions
```

### Chat Control
```
GET    /admin/chats                       # List all chats
POST   /admin/chats/:chat_id/restrict     # Restrict chat
POST   /admin/chats/:chat_id/close        # Force close chat
POST   /admin/chats/:chat_id/forward      # Forward to another admin
GET    /admin/chats/:chat_id/transcript   # Export chat history
```

---

## 3.6 Shared Endpoints

### Notifications
```
GET    /notifications                     # Get notifications (paginated)
GET    /notifications/unread-count        # Badge count
GET    /notifications/critical            # Critical alerts only
PATCH  /notifications/:notificationId/read # Mark as read
PATCH  /notifications/all/read            # Mark all as read
DELETE /notifications/:notificationId     # Delete notification
```

### Real-Time Chat (Socket.IO)
```
socket.on('chat:send_message')
socket.on('chat:start_typing')
socket.on('chat:stop_typing')
socket.on('subscribe:context')
socket.on('notification:new')
```

---

# 4. Notification System (Complete)

## 4.1 Notification Architecture

```
┌─────────────────────────────────────────────────────────────┐
│          NOTIFICATION LIFECYCLE FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Business Event                                              │
│        ↓                                                      │
│  createNotificationWithRealtime(io, data)                   │
│        ↓                                                      │
│  ┌─────────────────────────────────────────────────┐        │
│  │  1. Insert into notifications table              │        │
│  │  2. Create audit log (triggered_by)              │        │
│  │  3. Emit Socket.IO event:                        │        │
│  │     - to:user:${user_id}                         │        │
│  │     - to:context:${query_code|work_code}         │        │
│  │  4. Return notification_id                       │        │
│  └─────────────────────────────────────────────────┘        │
│        ↓                                                      │
│  Frontend receives realtime event                           │
│        ↓                                                      │
│  Update UI badge + show toast                               │
│        ↓                                                      │
│  User can:                                                   │
│   • Click notification → Mark as read + navigate             │
│   • Mark all as read                                         │
│   • Delete notification                                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 4.2 Notification Triggers by Event

| Event | Receiver | Type | Title | Message |
|-------|----------|------|-------|---------|
| **Query Submitted** | BDE | success | New Query Received | Topic: X, Client: Y, Urgency: Z |
| **Quotation Generated** | Client | info | Quotation Ready | Your quotation is ready at $X |
| **Payment Uploaded** | Admin | warning | Payment Awaiting Verification | Order #X, Amount: $Y (Receipt required) |
| **Payment Verified** | Client | success | Payment Confirmed | Order confirmed, work starts |
| **Writer Assigned** | Writer | critical | New Task Assigned | Topic: X, Deadline: Y |
| **Task Evaluated** | Writer | success | Task Evaluated | You marked as "Doable", work assigned |
| **Task Rejected** | Writer | warning | Task Not Doable | You marked as "Not Doable", task reassigned |
| **Draft Submitted** | Admin | info | Draft Awaiting QC | Writer: X, Order: Y |
| **QC Approved** | Writer+Client | success | Work Approved | Order ready for payment |
| **QC Rejected** | Writer | warning | Revisions Required | Feedback: [feedback text] |
| **Final Payment Verified** | Client | success | Work Delivered | Download from dashboard |
| **Revision Requested** | Writer | critical | Revision Requested | Reason: [reason], Deadline: [date] |
| **Order Completed** | Client | success | Order Completed | Thank you! Please rate writer |
| **Deadline Reminder (24h)** | Writer | warning | Deadline Reminder (24h) | Time remaining: 24 hours |
| **Deadline Reminder (12h)** | Writer | warning | Deadline Reminder (12h) | Time remaining: 12 hours |
| **Deadline Reminder (6h)** | Writer | critical | Deadline Reminder (6h) | Time remaining: 6 hours |
| **Deadline Reminder (1h)** | Writer | critical | Deadline Reminder (1h) | Time remaining: 1 hour |

## 4.3 Notification Service Implementation

**File**: `utils/notifications.js`

```javascript
/**
 * Core notification functions (Already implemented):
 * 
 * ✅ sendNotification(userId, message, type, metadata)
 * ✅ getNotifications(userId, limit)
 * ✅ markAsRead(notificationId)
 * ✅ markAllAsRead(userId)
 * ✅ deleteNotification(notificationId)
 * ✅ clearAllNotifications(userId)
 * ✅ createNotificationWithRealtime(io, data)
 *    - Inserts into DB
 *    - Emits Socket.IO events
 *    - Creates audit log
 * ✅ broadcastNotificationToRole(io, role, data)
 */
```

**Usage in Controllers:**

```javascript
// In payment.controller.js - when payment is verified
await notificationsController.createNotificationWithRealtime(req.io, {
  user_id: client_id,
  type: 'success',
  title: 'Payment Confirmed - Order Processing',
  message: `Your payment for order #${work_code} has been verified.`,
  link_url: `/client/orders/${order_id}`,
  context_code: work_code,
  triggered_by: {
    user_id: req.user.user_id,
    role: 'admin',
    ip_address: req.ip,
    user_agent: req.headers['user-agent']
  }
});

// In assignment.controller.js - when writer is assigned
await notificationsController.createNotificationWithRealtime(req.io, {
  user_id: writer_id,
  type: 'critical',
  title: `New Task Assigned: ${paper_topic}`,
  message: `Deadline: ${deadline_at}. Urgency: ${urgency}`,
  link_url: `/writer/tasks/${order_id}`,
  context_code: work_code,
  triggered_by: { user_id: req.user.user_id, role: 'admin' }
});
```

## 4.4 Notification Preferences (Future Enhancement)

```sql
-- Add to users table:
-- notification_frequency ENUM('realtime', '30min', '1hour', 'daily')
-- push_enabled TINYINT
-- email_enabled TINYINT

-- Add notification_settings table:
CREATE TABLE notification_settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT UNIQUE NOT NULL,
  email_on_assignment TINYINT DEFAULT 1,
  email_on_payment TINYINT DEFAULT 1,
  push_on_deadline TINYINT DEFAULT 1,
  digest_frequency ENUM('realtime', 'daily', 'weekly') DEFAULT 'realtime',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
```

---

# 5. Payment Workflows

## 5.1 Payment State Machine

```
INITIAL STATE: order created, no payment

          ┌─────────────────────────────────────┐
          │  Client Uploads Payment Receipt    │
          │  (50% or 100% or wallet deduction) │
          └──────────────┬──────────────────────┘
                         ↓
          ┌─────────────────────────────────────┐
          │  Payment record created:            │
          │  - payment_method: 'receipt_upload' │
          │  - payment_type: '50%' or '100%'    │
          │  - payment_doc: receipt filename    │
          │  - created_at: NOW()                │
          └──────────────┬──────────────────────┘
                         ↓
          ┌─────────────────────────────────────┐
          │  Status: PAYMENT_UPLOADED           │
          │  (Client sees: "Awaiting Verify")   │
          │  (Admin sees: "Pending Review")     │
          └──────────────┬──────────────────────┘
                         ↓
          ┌─────────────────────────────────────┐
          │ Admin Views & Verifies Receipt      │
          │ Routes: /admin/payments/:id/verify  │
          └──────────────┬──────────────────────┘
                         ↓
          ╔═════════════════════════════════════╗
          ║  PAYMENT VERIFICATION (CRITICAL)    ║
          ║  Admin must verify receipt          ║
          ║  Two possible outcomes:             ║
          ╚═════════════════════════════════════╝
                   ↙                    ↖
        ┌─────────────────┐    ┌─────────────────┐
        │  VERIFY         │    │  REJECT         │
        │  (APPROVE)      │    │  (DECLINE)      │
        └────────┬────────┘    └────────┬────────┘
                 ↓                      ↓
    ┌───────────────────────┐  ┌──────────────────────┐
    │ Generate work_code    │  │ Mark payment rejected │
    │ in format:            │  │ Client notified      │
    │ YYYY+CODE             │  │ Can reupload receipt │
    │ Ex: 2025SS001         │  └──────────────────────┘
    └───────────┬───────────┘
                ↓
    ┌───────────────────────────────────────┐
    │ Update orders table:                  │
    │ SET work_code = ?                     │
    │ SET status = ORDER_CONFIRMED_STATUS   │
    │ SET acceptance = 1                    │
    │ WHERE order_id = ?                    │
    └───────────┬───────────────────────────┘
                ↓
    ┌───────────────────────────────────────┐
    │ Deduct from wallet (if applicable)    │
    │ Create wallet_transaction record      │
    │ type = 'debit'                        │
    │ reason = 'Order Payment'              │
    └───────────┬───────────────────────────┘
                ↓
    ┌───────────────────────────────────────┐
    │ Create audit log entry:               │
    │ event_type = 'PAYMENT_VERIFIED'       │
    │ action = 'payment_verified'           │
    │ verified_by = admin_id                │
    └───────────┬───────────────────────────┘
                ↓
    ┌───────────────────────────────────────┐
    │ Send notifications:                   │
    │ - Client: "Payment Confirmed"         │
    │ - Admin: "Order Ready for Assignment" │
    └───────────┬───────────────────────────┘
                ↓
    ┌───────────────────────────────────────┐
    │ Status: ORDER_CONFIRMED               │
    │ Now admin can assign writer            │
    │ Client can see order in "My Orders"   │
    └───────────────────────────────────────┘
```

## 5.2 Payment Endpoints Implementation

### Upload Payment Receipt (Client)

```
POST /client/payments/:order_id/upload
Authorization: Bearer <TOKEN>
Content-Type: multipart/form-data

Parameters:
- receipt: file (PDF/JPG/PNG, max 10MB)
- payment_type: '50%' or '100%'
- notes: optional string

Response:
{
  "success": true,
  "data": {
    "payment_id": 789,
    "order_id": 456,
    "payment_type": "50%",
    "status": "pending_verification",
    "receipt_filename": "receipt_456_20260111.pdf",
    "created_at": "2026-01-11T10:00:00Z"
  }
}
```

### Verify Payment (Admin - CRITICAL)

```
POST /admin/payments/:payment_id/verify
Authorization: Bearer <TOKEN>
Content-Type: application/json

Request:
{
  "verified_at": "2026-01-11T10:05:00Z",
  "notes": "Receipt verified, amount matches",
  "approve": true
}

Response:
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "payment_id": 789,
    "order_id": 456,
    "work_code": "2025SS001",
    "status": "verified",
    "verified_by": 1,
    "verified_at": "2026-01-11T10:05:00Z"
  }
}

Side Effects:
✓ order.work_code = "2025SS001"
✓ order.status = ORDER_CONFIRMED_STATUS
✓ order.acceptance = 1
✓ Client wallet debited (if applicable)
✓ Audit log created
✓ Notifications sent
✓ order_history record created
```

### Reject Payment (Admin)

```
POST /admin/payments/:payment_id/reject
Authorization: Bearer <TOKEN>
Content-Type: application/json

Request:
{
  "reason": "Receipt unclear or insufficient amount",
  "reupload_deadline": "2026-01-12T10:00:00Z"
}

Response:
{
  "success": true,
  "message": "Payment rejected",
  "data": {
    "payment_id": 789,
    "status": "rejected",
    "reason": "Receipt unclear or insufficient amount"
  }
}

Side Effects:
✓ Payment marked as rejected
✓ Order remains in QUOTATION_GENERATED status
✓ Client notified to reupload
✓ Audit log created
```

---

# 6. Chat System

## 6.1 Chat Context & Access Control

```
ALLOWED CHAT RELATIONSHIPS:
├── Client ↔ BDE        (Query Context: QUERY_xxx)
├── Client ↔ BDE        (Order Context: WORK_xxx)
├── BDE ↔ Admin         (Any context)
├── Writer ↔ Admin      (Order Context: WORK_xxx)
└── Client ↔ Admin      (Emergency override - Admin initiated)

BLOCKED RELATIONSHIPS:
├── ❌ Client ↔ Writer   (No direct communication)
├── ❌ BDE ↔ Writer      (No direct communication)
└── ❌ Writer ↔ Writer   (No peer communication)
```

## 6.2 Chat Architecture

```
┌────────────────────────────────────────────────────┐
│          CHAT STORAGE & RETRIEVAL                  │
├────────────────────────────────────────────────────┤
│                                                     │
│  Table: order_chats                                │
│  ├─ chat_id (PK)                                   │
│  ├─ order_id (FK to orders)                        │
│  ├─ chat_name (e.g., "Client-BDE Discussion")      │
│  ├─ participants (JSON)                            │
│  │  └─ [user_id, role, name, joined_at]           │
│  ├─ messages (JSON Array)                          │
│  │  └─ [{ id, sender_id, sender_role, content,    │
│  │      timestamp, message_type, edited, deleted}] │
│  ├─ status ('active', 'restricted', 'closed')      │
│  ├─ created_at                                     │
│  └─ updated_at                                     │
│                                                     │
│  Real-time: Socket.IO Channel                      │
│  ├─ Socket.IO Namespace: /chat                     │
│  ├─ Channel: context:${query_code|work_code}       │
│  └─ Events:                                        │
│     • chat:new_message                             │
│     • chat:user_typing                             │
│     • chat:user_stop_typing                        │
│     • chat:message_edited                          │
│     • chat:message_deleted                         │
│     • chat:user_joined                             │
│     • chat:user_left                               │
│     • chat:restricted                              │
│     • chat:closed                                  │
│                                                     │
└────────────────────────────────────────────────────┘
```

## 6.3 Chat Implementation

**File**: `controllers/chat.controller.js`

### Send Message

```javascript
// POST /chat/:context_code/message
exports.sendMessage = async (req, res) => {
  const { context_code } = req.params;
  const { message, message_type = 'text' } = req.body;
  const sender_id = req.user.user_id;
  const sender_role = req.user.role;

  try {
    // 1. Validate access
    const order = await validateChatAccess(sender_id, sender_role, context_code);
    
    // 2. Get or create chat
    let chat = await getOrderChat(order.order_id);
    if (!chat) {
      chat = await createOrderChat(order.order_id, 'Order Chat');
    }

    // 3. Create message object
    const messageObj = {
      id: Date.now(),
      sender_id,
      sender_role,
      sender_name: req.user.full_name,
      content: message,
      message_type, // 'text', 'file', 'system'
      timestamp: new Date().toISOString(),
      is_edited: false,
      is_deleted: false
    };

    // 4. Append to messages array (JSON)
    const messages = JSON.parse(chat.messages || '[]');
    messages.push(messageObj);

    // 5. Update chat
    await db.query(
      `UPDATE order_chats SET messages = ?, updated_at = NOW() 
       WHERE chat_id = ?`,
      [JSON.stringify(messages), chat.chat_id]
    );

    // 6. Create notification for other participants
    const otherParticipants = await getOtherParticipants(
      order.order_id, 
      sender_id
    );
    
    for (const participant of otherParticipants) {
      await notificationsController.createNotificationWithRealtime(req.io, {
        user_id: participant.user_id,
        type: 'info',
        title: `New message from ${req.user.full_name}`,
        message: message.substring(0, 100),
        link_url: `/orders/${order.order_id}#chat`,
        context_code,
        triggered_by: { user_id: sender_id, role: sender_role }
      });
    }

    // 7. Emit real-time event
    req.io.to(`context:${context_code}`).emit('chat:new_message', {
      chat_id: chat.chat_id,
      context_code,
      message: messageObj
    });

    // 8. Audit log
    await createAuditLog({
      event_type: 'CHAT_MESSAGE_SENT',
      user_id: sender_id,
      resource_type: 'Chat',
      resource_id: chat.chat_id,
      details: `Message sent in context ${context_code}`,
      event_data: { message_length: message.length, context_code }
    });

    return res.json({ success: true, message_id: messageObj.id });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
```

### Typing Indicators

```javascript
// Real-time typing indicator (Socket.IO)
socket.on('chat:start_typing', async (data) => {
  const { context_code } = data;
  
  // Validate access
  const hasAccess = await validateChannelAccess(socket, `context:${context_code}`);
  if (!hasAccess) return;

  // Emit to context participants
  io.to(`context:${context_code}`).emit('chat:user_typing', {
    user_id: socket.user_id,
    user_name: socket.user_name,
    context_code
  });
});

socket.on('chat:stop_typing', (data) => {
  const { context_code } = data;
  io.to(`context:${context_code}`).emit('chat:user_stop_typing', {
    user_id: socket.user_id,
    context_code
  });
});
```

---

# 7. Role-Based Access Control (RBAC)

## 7.1 Middleware Implementation

**File**: `middleware/rbac.middleware.js`

```javascript
const requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: 'Authorization token missing'
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const userRole = decoded.role?.toLowerCase();
      if (!allowedRoles.map(r => r.toLowerCase()).includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Required roles: ${allowedRoles.join(', ')}`
        });
      }

      req.user = {
        user_id: decoded.user_id,
        role: userRole,
        email: decoded.email
      };

      next();

    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
  };
};

module.exports = { requireRole };
```

## 7.2 RBAC Rules Matrix

| Endpoint | Client | BDE | Writer | Admin | Notes |
|----------|--------|-----|--------|-------|-------|
| POST /client/queries | ✅ | ❌ | ❌ | ❌ | Client creates query |
| GET /bde/clients | ❌ | ✅ | ❌ | ❌ | BDE views own clients |
| POST /admin/payments/:id/verify | ❌ | ❌ | ❌ | ✅ | Only admin verifies |
| GET /writer/tasks | ❌ | ❌ | ✅ | ❌ | Writer views tasks |
| GET /admin/audit-logs | ❌ | ❌ | ❌ | ✅ | Admin only audit |
| POST /chat/message | ✅ | ✅ | ✅ | ✅ | Context-aware (see Chat) |

## 7.3 Context-Level Authorization

Beyond roles, some operations require context checks:

```javascript
// Example: User can only see their own notifications
exports.getNotifications = async (req, res) => {
  const userId = req.user.user_id;  // From token
  const requestedUserId = req.query.user_id;

  if (requestedUserId && userId !== parseInt(requestedUserId) && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Cannot access other users notifications'
    });
  }

  // Proceed with query
};

// Example: BDE can only manage own clients
exports.getClients = async (req, res) => {
  const bdeId = req.user.user_id;
  const [clients] = await db.query(
    `SELECT * FROM users WHERE bde = ? AND role = 'client'`,
    [bdeId]
  );
  res.json({ success: true, data: clients });
};
```

---

# 8. Workflow State Machines

## 8.1 Query to Order Lifecycle

```
START: User submits query
         ↓
  [QUERY_SUBMITTED]
  ├─ order.work_code = NULL
  ├─ order.acceptance = 0
  ├─ order.status = QUERY_SUBMITTED_STATUS
  ├─ Client sees: "Query Submitted Successfully"
  ├─ BDE sees: "New Query Received"
  └─ Notification: Query created ✉️

         ↓

  BDE generates quotation
         ↓
  [QUOTATION_GENERATED]
  ├─ quotations table: New row with quoted_price
  ├─ Client sees: "Quotation Ready"
  ├─ Notification: "Your quotation is ready" ✉️
  └─ Client can accept/reject

         ↓

Client uploads payment
         ↓
  [PAYMENT_UPLOADED]
  ├─ payments table: New row
  ├─ payment_type = '50%' or '100%'
  ├─ Client sees: "Awaiting Verification"
  ├─ Admin sees: "Pending Review"
  └─ Notification: Sent to admin ✉️

         ↓

Admin verifies payment
         ↓
  [PAYMENT_VERIFIED]
  ├─ work_code GENERATED (e.g., "2025SS001")
  ├─ order.acceptance = 1
  ├─ order.status = ORDER_CONFIRMED_STATUS
  ├─ Client sees: "Order Confirmed"
  ├─ Admin sees: "Ready for Writer Assignment"
  └─ Notification: "Order confirmed" ✉️

         ↓

Admin assigns writer
         ↓
  [WRITER_ASSIGNED]
  ├─ order.writer_id = writer_id
  ├─ task_evaluations table: New row (status='pending')
  ├─ Writer sees: "New Task Assigned"
  ├─ Notification: "New task assigned" (CRITICAL) ✉️
  └─ Writer must evaluate (Doable/Not Doable)

         ↓

Writer evaluates task
         ↓
  ┌─────────────┬──────────────────────┐
  ↓ DOABLE      ↓ NOT DOABLE           
  │             │                      
  [TASK_        [TASK_NOT_DOABLE]      
   ACCEPTED]    ├─ Admin reassigns      
  ├─ Writer     ├─ Writer notified ✉️   
  │  starts     └─ Back to assignment   
  │  work       
  └─ Notif ✉️   
         ↓

Writer submits draft
         ↓
  [DRAFT_SUBMITTED_QC]
  ├─ submissions table: draft entry
  ├─ status = 'pending_qc'
  ├─ Admin sees: "Pending QC Review"
  ├─ Writer sees: "Submitted for Review"
  └─ Notification: Sent to admin ✉️

         ↓

Admin reviews & approves
         ↓
  [QC_APPROVED]
  ├─ submissions.status = 'approved'
  ├─ order.status = QC_APPROVED_STATUS
  ├─ Writer notified ✉️
  ├─ Client sees: "Final delivery ready"
  └─ Final payment verification pending

         ↓

Final payment verified
         ↓
  [FILES_DELIVERED]
  ├─ files available in order
  ├─ Client can download
  ├─ order.status = FINAL_DELIVERY_STATUS
  └─ Notification: "Files ready" ✉️

         ↓

Client gives feedback
         ↓
  [FEEDBACK_RECEIVED]
  ├─ writer_ratings table: New row
  ├─ order.status = FEEDBACK_RECEIVED_STATUS
  ├─ Writer sees: Feedback + rating
  └─ Notification: Writer notified ✉️

         ↓

  [ORDER_COMPLETED]
  └─ END
```

## 8.2 Payment Verification (Critical Sub-Flow)

```
payment_uploaded
      ↓
admin.verifyPayment()
      ↓
   Transaction BEGIN
      ↓
   ┌──────────────────────────────────┐
   │ 1. Verify payment record exists  │
   │ 2. Verify order exists           │
   │ 3. Check amount matches          │
   └──────────────┬───────────────────┘
                  ↓
   ┌──────────────────────────────────┐
   │ 4. Generate work_code            │
   │    Format: YYYY + CODE           │
   │    Example: 2025SS001            │
   └──────────────┬───────────────────┘
                  ↓
   ┌──────────────────────────────────┐
   │ 5. Update orders:                │
   │    SET work_code = ?             │
   │    SET acceptance = 1            │
   │    SET status = CONFIRMED        │
   └──────────────┬───────────────────┘
                  ↓
   ┌──────────────────────────────────┐
   │ 6. Deduct from wallet (if config)│
   │    INSERT wallet_transaction     │
   │    type = 'debit'                │
   │    reason = 'Order Payment'      │
   └──────────────┬───────────────────┘
                  ↓
   ┌──────────────────────────────────┐
   │ 7. Create audit log              │
   │    event_type = 'PAYMENT_VERIFIED'│
   │    verified_by = admin_id        │
   └──────────────┬───────────────────┘
                  ↓
   ┌──────────────────────────────────┐
   │ 8. Create order_history record   │
   │    action_type = 'PAYMENT_VERIFIED'
   │    modified_by_role = 'admin'    │
   └──────────────┬───────────────────┘
                  ↓
   ┌──────────────────────────────────┐
   │ 9. Send notifications:           │
   │    - to: client_id               │
   │    - type: success               │
   │    - title: "Payment Confirmed"  │
   │    - link: /orders/:order_id     │
   │    - context: work_code          │
   └──────────────┬───────────────────┘
                  ↓
   ┌──────────────────────────────────┐
   │ 10. Emit Socket.IO events        │
   │    - user:${client_id}           │
   │    - context:${work_code}        │
   └──────────────┬───────────────────┘
                  ↓
   Transaction COMMIT
      ↓
   RETURN { success: true, work_code }
```

---

# 9. Deployment & Configuration

## 9.1 Environment Variables

Create `.env` file:

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=db_assignment_366

# JWT
JWT_SECRET=your_jwt_secret_key_min_32_chars

# Email
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM=noreply@a366.com

# OTP/SMS (Twilio)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=52428800  # 50MB

# Cron Jobs
DEADLINE_REMINDER_INTERVAL=3600000  # 1 hour in ms
```

## 9.2 Database Setup

```bash
# 1. Create database
mysql -u root -p
> CREATE DATABASE db_assignment_366;
> USE db_assignment_366;

# 2. Run schema (from DATABASE_SCHEMA.md)
# 3. Insert master data
mysql -u root -p db_assignment_366 < schema.sql
mysql -u root -p db_assignment_366 < seed-data.sql
```

## 9.3 Installation & Running

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your values

# Start development
npm run dev

# Start production
npm start

# Build CSS (Tailwind)
npm run build:css
```

## 9.4 Socket.IO Real-Time Setup

Socket.IO automatically initializes in `server.js`:

```javascript
const { Server } = require('socket.io');
const http = require('http');
const { socketAuthMiddleware } = require('./middleware/socket.auth.middleware');
const { initializeRealtime } = require('./utils/realtime');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.use(socketAuthMiddleware);
initializeRealtime(io);
```

Clients connect:

```html
<!-- In HTML -->
<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
<script src="/js/realtime-notifications.js"></script>
```

---

# 10. Testing Scenarios

## 10.1 Complete User Journey (Client)

### Scenario: Client submits query and completes order

```
STEP 1: Client Registration
POST /auth/client/otp/email
  → Email: client@university.edu
  → Response: OTP sent

POST /auth/client/otp/verify
  → OTP: 123456
  → Response: JWT token

STEP 2: Client submits query
POST /client/queries
  → Topic: "Effects of Climate Change on Ocean Ecosystems"
  → Service: "Academic Writing"
  → Subject: "Environmental Science"
  → Urgency: "Standard"
  → Deadline: 2026-01-25
  → File: assignment_requirements.pdf
  → Response: query_code = "QUERY_ABC12345"

STEP 3: Client views quotation
GET /client/quotations/:order_id
  → Response: quoted_price = $125, notes from BDE

STEP 4: Client uploads payment
POST /client/payments/:order_id/upload
  → Receipt: receipt.pdf
  → Payment Type: "100%"
  → Response: payment_id = 789, status = "pending_verification"

STEP 5: Admin verifies (awaits admin action)

STEP 6: Client sees order confirmed
GET /client/orders/:order_id
  → Response: work_code = "2025SS001"
  → Order status = "ORDER_CONFIRMED"

STEP 7: Writer completes work

STEP 8: Client downloads files
GET /client/orders/:order_id/files

STEP 9: Client provides feedback
POST /client/orders/:order_id/feedback
  → Rating: 5
  → Review: "Excellent work!"
```

## 10.2 Admin Payment Verification Flow

```
STEP 1: Admin checks pending payments
GET /admin/payments?status=pending

STEP 2: Admin views payment details
GET /admin/payments/:payment_id
  → Shows receipt, order details, amount

STEP 3: Admin verifies payment
POST /admin/payments/:payment_id/verify
  → Request: { "approve": true, "notes": "Verified" }
  → Response: work_code = "2025SS001" generated

STEP 4: Verify in database
  → orders.work_code = "2025SS001"
  → orders.acceptance = 1
  → payments table: PAYMENT_VERIFIED record
  → audit_logs: PAYMENT_VERIFIED event
  → notifications: Client notified

STEP 5: Admin assigns writer
POST /admin/orders/:order_id/assign-writer
  → writer_id: 5
  → Response: Writer notified, task_evaluations created

STEP 6: Writer evaluates & starts
STEP 7: Admin reviews & approves
STEP 8: Client gets files
```

---

## Summary of Implementation Status

| Feature | Status | File(s) |
|---------|--------|---------|
| **Authentication** | ✅ Complete | auth.*.controller.js, auth.*.routes.js |
| **RBAC Middleware** | ✅ Complete | rbac.middleware.js |
| **Notifications** | ✅ Complete | notifications.controller.js, utils/notifications.js |
| **Chat System** | ✅ Complete | chat.controller.js, utils/realtime.js |
| **Payment Verification** | ✅ Complete | admin.payment.controller.js |
| **Deadline Reminders** | ✅ Complete | utils/deadline-reminders.js |
| **Audit Logging** | ✅ Complete | utils/audit.js |
| **Real-time Socket.IO** | ✅ Complete | utils/realtime.js, public/js/realtime-notifications.js |
| **Database Schema** | ✅ Complete | Aligned with spec |
| **Work Code Generation** | ✅ Complete | admin.payment.controller.js |
| **Wallet Management** | ✅ Complete | Payment flows |
| **Query Submission** | ✅ Complete | client.queries.controller.js |
| **Order Tracking** | ✅ Complete | client.profile.controller.js |
| **Writer Assignment** | ✅ Complete | admin.controller.js |
| **QC & Approvals** | ✅ Complete | admin.qc.delivery.controller.js |
| **Revision Requests** | ✅ Complete | delivery.controller.js |
| **Writer Tasks** | ✅ Complete | writer.tasks.controller.js |
| **BDE Dashboard** | ✅ Complete | bde.dashboard.controller.js |
| **Admin Dashboard** | ✅ Complete | admin.dashboard.controller.js |
| **File Versioning** | ✅ Complete | File upload flows |

---

## Production Checklist

- [ ] Environment variables configured (.env)
- [ ] Database created and schema initialized
- [ ] JWT_SECRET is strong (32+ chars, random)
- [ ] Database backups configured
- [ ] Email service credentials set
- [ ] OTP/SMS service (Twilio) configured
- [ ] Socket.IO CORS properly configured for domain
- [ ] File upload directory has write permissions
- [ ] Node.js production mode enabled
- [ ] Error logging service configured
- [ ] Rate limiting implemented
- [ ] HTTPS enabled on production
- [ ] Admin account created
- [ ] Test payment flow end-to-end
- [ ] Test notification delivery
- [ ] Test real-time chat
- [ ] Monitor database performance

---

## Support & Troubleshooting

### Issue: Notifications not appearing

**Solution:**
1. Check Socket.IO connection in browser console
2. Verify user is subscribed to correct channel
3. Check `notifications.js` and `realtime.js` for errors
4. Ensure JWT token is valid

### Issue: Payment verification fails

**Solution:**
1. Check database transaction logs
2. Verify order exists and has payment record
3. Ensure admin has proper RBAC role
4. Check audit_logs for error details

### Issue: Chat messages not syncing

**Solution:**
1. Verify order_chats record exists
2. Check JSON parsing in messages field
3. Ensure both users are in allowed relationship
4. Verify Socket.IO rooms are correct

---

**Document End**

For questions or updates, refer to API endpoints and controller implementations.

Generated: January 11, 2026
