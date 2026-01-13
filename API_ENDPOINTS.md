# A366 Assignment Platform - Complete API Documentation

## Overview

This document provides the authoritative API endpoint reference for the A366 academic assignment platform. The platform serves four roles: **Client**, **BDE** (Business Development Executive), **Writer**, and **Admin**.

All endpoints require JWT authentication unless otherwise specified.

---

## Table of Contents

1. [Authentication](#authentication)
2. [Client API](#client-api)
3. [BDE API](#bde-api)
4. [Writer API](#writer-api)
5. [Admin API](#admin-api)
6. [Notifications API](#notifications-api)
7. [Chat API](#chat-api)
8. [Status Codes & State Machine](#status-codes--state-machine)

---

## Authentication

### All Roles - JWT Token

All authenticated requests must include:
```
Authorization: Bearer <jwt_token>
```

Token payload contains:
```json
{
  "user_id": 123,
  "role": "client|bde|writer|admin"
}
```

---

## Client API

Base Path: `/auth/client` (auth) and `/client` (protected routes)

### Authentication Endpoints

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/auth/client/register/send-otp` | Send registration OTP | No |
| POST | `/auth/client/register/verify-otp` | Verify OTP & create account | No |
| POST | `/auth/client/login` | Password-based login | No |
| POST | `/auth/client/login/request-otp` | Request login OTP | No |
| POST | `/auth/client/login/verify-otp` | Verify OTP & login | No |

#### POST /auth/client/register/send-otp
```json
// Request
{ "email": "user@example.com" }

// Response
{ "success": true, "message": "OTP sent to email" }
```

#### POST /auth/client/register/verify-otp
```json
// Request
{
  "full_name": "John Doe",
  "email": "user@example.com",
  "mobile_number": "+1234567890",
  "otp": "123456",
  "referal_code": "A366XXXXX" // optional
}

// Response
{ "success": true, "message": "Account created successfully" }
```

#### POST /auth/client/login/request-otp
```json
// Request
{ "email": "user@example.com" }

// Response
{ "success": true, "message": "OTP sent to your email" }
```

#### POST /auth/client/login/verify-otp
```json
// Request
{ "email": "user@example.com", "otp": "123456" }

// Response
{
  "success": true,
  "token": "jwt_token_here",
  "user": {
    "user_id": 1,
    "full_name": "John Doe",
    "email": "user@example.com",
    "role": "client"
  }
}
```

### Profile Management

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/client/profile` | Get client profile | Client |
| PATCH | `/client/profile` | Update allowed fields | Client |

#### PATCH /client/profile
**IMPORTANT**: Client can ONLY update `university` and `currency_code`

```json
// Request
{
  "university": "Harvard University",
  "currency_code": "USD"
}

// Response
{ "success": true, "message": "Profile updated" }
```

### Query Management

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/client/queries` | Create new query | Client |
| GET | `/client/queries` | List client's queries | Client |
| GET | `/client/queries/:orderId` | Get query details | Client |
| PUT/PATCH | `/client/queries/:orderId` | **DENIED** - Returns error | Client |

#### POST /client/queries
```json
// Request
{
  "paper_topic": "Climate Change Impact",
  "service": "Research Paper",
  "subject": "Environmental Science",
  "urgency": "High",
  "description": "Need 15-page research paper...",
  "deadline_at": "2026-02-15T00:00:00Z"
}

// Response
{
  "success": true,
  "data": {
    "order_id": 123,
    "query_code": "QUERY_ABC12345",
    "status": "pending"
  }
}
```

### Quotation & Payment

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/client/quotations/:orderId` | View quotation | Client |
| POST | `/client/quotations/:orderId/accept` | Accept quotation | Client |
| POST | `/client/payments/upload` | Upload payment receipt | Client |
| GET | `/client/payments/:orderId/status` | Get payment status | Client |

#### POST /client/quotations/:orderId/accept
```json
// Response
{
  "success": true,
  "message": "Quotation accepted. Next, upload payment receipt."
}
```

### Order Tracking

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/client/orders` | List confirmed orders | Client |
| GET | `/client/orders/:workCode` | Track order by work_code | Client |
| GET | `/client/orders/:orderId/delivery` | Get delivery files | Client |

### Feedback & Revisions

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/client/feedback` | Submit feedback | Client |
| POST | `/client/revisions` | Request revision | Client |
| GET | `/client/revisions/:orderId` | Get revision history | Client |

### Notifications

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/client/notifications` | Get notifications | Client |
| PATCH | `/client/notifications/:id/read` | Mark as read | Client |

---

## BDE API

Base Path: `/bde`

### Dashboard

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/bde/` | Dashboard with KPIs | BDE |

### Client Management (Referral-Based)

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/bde/clients` | List assigned clients | BDE |
| GET | `/bde/clients/:clientId` | View client details | BDE |

**Note**: BDE sees ONLY clients where `users.bde = bde_id`

### Query Management

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/bde/queries` | List queries | BDE |
| GET | `/bde/queries/:queryCode` | View query details | BDE |
| POST | `/bde/queries/:queryCode/status` | Update status (limited) | BDE |
| POST | `/bde/queries/:queryCode/quotation` | Generate quotation | BDE |

**BDE Limitations**:
- ❌ Cannot assign writers
- ❌ Cannot verify payments
- ❌ Cannot approve QC
- ❌ Cannot generate work_code

### Confirmed Orders (Read-Only)

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/bde/orders` | List confirmed orders | BDE |
| GET | `/bde/orders/:workCode` | View order details | BDE |

### Communication

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/bde/chat/query/:queryCode` | Get chat messages | BDE |
| POST | `/bde/queries/:queryCode/message` | Send message | BDE |

**BDE Chat Restrictions**:
- ✅ Can chat with Client
- ✅ Can chat with Admin
- ❌ Cannot chat with Writer

### Payments

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/bde/payments` | List pending payments | BDE |
| POST | `/bde/queries/:queryCode/payment-reminder` | Send reminder | BDE |

---

## Writer API

Base Path: `/writer`

### Dashboard & Profile

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/writer/` | Dashboard | Writer |
| GET | `/writer/profile` | View profile | Writer |
| POST | `/writer/update-profile` | Update profile | Writer |
| GET | `/writer/api/dashboard/kpis` | Get KPI metrics | Writer |

### Task Assignment

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/writer/api/tasks/pending` | Get pending assignments | Writer |
| GET | `/writer/api/tasks/:taskId/details` | Get task details | Writer |
| POST | `/writer/api/tasks/:taskId/accept` | Accept task (Doable) | Writer |
| POST | `/writer/api/tasks/:taskId/reject` | Reject task (Not Doable) | Writer |

#### POST /writer/api/tasks/:taskId/accept
```json
// Request
{ "comment": "I can complete this within the deadline" }

// Response
{ "success": true, "message": "Task accepted successfully" }
```

#### POST /writer/api/tasks/:taskId/reject
```json
// Request
{ "reason": "Topic is outside my expertise area" }

// Response
{ "success": true, "message": "Task rejected successfully" }
```

### Task Execution

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/writer/api/tasks/active/list` | Get active tasks | Writer |
| POST | `/writer/api/tasks/:taskId/status` | Update task status | Writer |

**Writer Restrictions**:
- ❌ Cannot see pricing
- ❌ Cannot see payments
- ❌ Cannot see client contact details

### File Management

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/writer/api/tasks/:taskId/upload` | Upload file | Writer |
| GET | `/writer/api/tasks/:taskId/files` | Get file history | Writer |

### QC Workflow

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/writer/api/tasks/:taskId/submit-qc` | Submit for QC | Writer |
| GET | `/writer/api/tasks/:taskId/feedback` | Get QC feedback | Writer |
| POST | `/writer/api/tasks/:taskId/revision` | Submit revision | Writer |

**QC Flow**:
1. Writer submits → Status: `Pending QC`
2. Admin approves → Status: `Approved`
3. Admin rejects → Status: `Revision Required`
4. Writer resubmits → Back to step 1

---

## Admin API

Base Path: `/admin`

### Dashboard

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/admin/` | Admin dashboard | Admin |
| GET | `/admin/dashboard/kpis` | Get KPI metrics | Admin |

### Query & Order Management

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/admin/queries` | List all queries | Admin |
| GET | `/admin/queries/:queryId/view` | View query details | Admin |
| POST | `/admin/queries/:queryId/status` | Update status | Admin |
| POST | `/admin/queries/:queryId/quotation` | Generate quotation | Admin |
| GET | `/admin/queries/available-writers` | Get available writers | Admin |
| POST | `/admin/queries/:queryId/assign` | Assign writers | Admin |
| POST | `/admin/queries/:queryId/message` | Send message to client | Admin |
| POST | `/admin/queries/reassign-writer` | Reassign writer | Admin |

### Payment Verification (CRITICAL)

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/admin/payments` | List payments | Admin |
| GET | `/admin/payments/:paymentId/view` | View payment details | Admin |
| POST | `/admin/payments/:paymentId/verify` | **Verify payment** | Admin |

#### POST /admin/payments/:paymentId/verify
**CRITICAL OPERATION** - Only Admin can verify payments

On verification:
1. Validates payment amount matches order total
2. Generates `work_code`
3. Converts query to confirmed order
4. Triggers writer assignment flow
5. Creates audit log
6. Sends notifications

```json
// Request
{
  "payment_id": 123,
  "notes": "Verified via bank statement",
  "approve": true
}

// Response
{
  "success": true,
  "message": "Payment verified",
  "data": {
    "work_code": "WORK_ABC123456789"
  }
}
```

### Quality Control (QC)

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/admin/qc/submissions` | List submissions | Admin |
| POST | `/admin/qc/:submissionId/approve` | Approve submission | Admin |
| POST | `/admin/qc/:submissionId/reject` | Reject submission | Admin |

### Delivery & Closure

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| POST | `/admin/delivery/deliver` | Deliver order | Admin |
| POST | `/admin/orders/:orderId/close` | Close order | Admin |

### Audit & Logs

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/admin/audit` | View audit logs | Admin |

---

## Notifications API

Base Path: `/notifications`

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/notifications` | Get user notifications | Any |
| POST | `/notifications/:id/read` | Mark as read | Any |

### Notification Types
- `success` - Positive events (payment verified, QC approved)
- `warning` - Attention needed (deadline approaching)
- `critical` - Urgent action required (revision needed)
- `info` - Informational updates

---

## Chat API

Base Path: `/chat`

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/chat/messages/:contextId` | Get messages | Any |
| POST | `/chat/send` | Send message | Any |

### Chat Restrictions by Role

| From | To Client | To BDE | To Writer | To Admin |
|------|-----------|--------|-----------|----------|
| Client | - | ✅ | ❌ | ✅ |
| BDE | ✅ | - | ❌ | ✅ |
| Writer | ❌ | ❌ | - | ✅ |
| Admin | ✅ | ✅ | ✅ | - |

---

## Status Codes & State Machine

### Order Status IDs (from master_status)

| ID | Status Name | Description |
|----|-------------|-------------|
| 26 | Pending Query | Initial state after client creates query |
| 27 | Quotation Sent | BDE/Admin sent quotation |
| 28 | Accepted | Client accepted quotation |
| 29 | Awaiting Verification | Client uploaded payment |
| 30 | Payment Verified | Admin verified payment |
| 31 | Writer Assigned | Writer(s) assigned to order |
| 32 | In Progress | Writer working on order |
| 33 | Pending QC | Writer submitted for QC review |
| 34 | Approved | QC passed, ready for delivery |
| 35 | Completed | Order completed (terminal state) |
| 36 | Revision Required | QC rejected, needs revision |
| 37 | Delivered | Files delivered to client |

### Valid Status Transitions by Role

#### Client
- 27 → 28 (Accept quotation)
- 28 → 29 (Upload payment)

#### BDE
- 26 → 27 (Generate quotation)
- 27 → 26 (Revoke quotation)

#### Writer
- 31 → 32 (Start work)
- 32 → 33 (Submit for QC)
- 36 → 33 (Resubmit after revision)

#### Admin (Full Control)
- All transitions except modifying completed orders

---

## Security Enforcement Rules

1. **Authentication Required** - Every API request must include valid JWT
2. **Role-Based Access** - Endpoints enforce role restrictions server-side
3. **State Machine Validation** - Status transitions validated before execution
4. **Audit Logging** - All critical actions logged to `audit_logs` table
5. **Writer Identity Hidden** - Client never sees writer information
6. **Payment Verification** - ONLY Admin can verify payments
7. **Completed Orders Locked** - No modifications after completion

---

## Error Response Format

```json
{
  "success": false,
  "message": "Error description",
  "error": "Technical error message (optional)"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation failed) |
| 401 | Unauthorized (invalid/missing token) |
| 403 | Forbidden (role not allowed) |
| 404 | Not Found |
| 409 | Conflict (duplicate resource) |
| 500 | Server Error |

---

## Rate Limiting

- OTP requests: 1 per minute per email
- General API: 100 requests per minute per user
- File uploads: 10 per minute per user

---

## File Upload Limits

- Maximum file size: 100MB
- Allowed types: PDF, DOC, DOCX, PPT, TXT
- Files are versioned (no deletion allowed)

---

*Last Updated: January 13, 2026*
