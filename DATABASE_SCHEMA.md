# Database Schema - db_assignment_366

Generated: 1/16/2026, 1:48:03 PM

================================================================================


## TABLE: audit_logs
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. user_id (int)
  3. event_type (varchar(100)) [NOT NULL]
  4. event_data (json)
  5. resource_type (varchar(50))
  6. resource_id (varchar(50))
  7. ip_address (varchar(45))
  8. user_agent (text)
  9. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  10. action (varchar(100))
  11. details (text)


## TABLE: chat_requests
--------------------------------------------------------------------------------
  1. request_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. from_user_id (int) [INDEX, NOT NULL]
  3. from_role (varchar(20))
  4. to_user_id (int) [INDEX, NOT NULL]
  5. request_type (enum('admin','bde')) [NOT NULL]
  6. message (text)
  7. status (enum('pending','approved','rejected')) [DEFAULT: pending]
  8. processed_by (int)
  9. processed_at (datetime)
  10. chat_id (int)
  11. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  12. approved_at (datetime)
  13. rejected_reason (text)

  Foreign Keys:
    - from_user_id → users.user_id
    - to_user_id → users.user_id


## TABLE: countries
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. iso_code (varchar(2)) [UNIQUE, NOT NULL]
  3. name (varchar(80)) [NOT NULL]
  4. phone_code (varchar(5)) [NOT NULL]
  5. currency_symbol (varchar(5)) [DEFAULT: $]
  6. currency_code (varchar(3)) [DEFAULT: USD]


## TABLE: coupons
--------------------------------------------------------------------------------
  1. coupon_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. coupon_code (varchar(50)) [UNIQUE, NOT NULL]
  3. discount_value (decimal(10,2)) [NOT NULL]
  4. discount_type (enum('Percentage','Flat')) [NOT NULL]
  5. is_active (tinyint) [DEFAULT: 0]
  6. expiry_date (date)


## TABLE: deadline_reminders
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (varchar(50)) [INDEX, NOT NULL]
  3. user_id (int) [INDEX, NOT NULL]
  4. reminder_type (enum('24h','12h','6h','1h')) [DEFAULT: 24h]
  5. is_sent (tinyint(1)) [INDEX, DEFAULT: 0]
  6. sent_at (datetime)
  7. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]

  Foreign Keys:
    - user_id → users.user_id


## TABLE: export_logs
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. user_id (int) [INDEX, NOT NULL]
  3. export_type (varchar(50)) [NOT NULL]
  4. file_format (enum('csv','pdf','xlsx')) [DEFAULT: csv]
  5. filters (json)
  6. file_path (varchar(500))
  7. status (enum('pending','completed','failed')) [DEFAULT: pending]
  8. created_at (datetime) [INDEX, DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  9. completed_at (datetime)

  Foreign Keys:
    - user_id → users.user_id


## TABLE: featuredservices
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. title (varchar(255)) [NOT NULL]
  3. description (varchar(500))
  4. is_active (tinyint) [DEFAULT: 1]


## TABLE: file_versions
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (varchar(50)) [INDEX, NOT NULL]
  3. file_url (varchar(500)) [NOT NULL]
  4. file_name (varchar(255)) [NOT NULL]
  5. uploaded_by (int)
  6. file_size (bigint)
  7. version_number (int) [NOT NULL, DEFAULT: 1]
  8. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  9. updated_at (datetime) [DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: general_chat_messages
--------------------------------------------------------------------------------
  1. message_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. chat_id (int) [INDEX, NOT NULL]
  3. sender_id (int) [INDEX, NOT NULL]
  4. content (text)
  5. message_type (enum('text','file','image')) [DEFAULT: text]
  6. attachments (json)
  7. is_read (json)
  8. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]

  Foreign Keys:
    - chat_id → general_chats.chat_id
    - sender_id → users.user_id


## TABLE: general_chat_participants
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. chat_id (int) [INDEX, NOT NULL]
  3. user_id (int) [INDEX, NOT NULL]
  4. role (varchar(20))
  5. joined_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  6. last_read_at (datetime)

  Foreign Keys:
    - chat_id → general_chats.chat_id
    - user_id → users.user_id


## TABLE: general_chats
--------------------------------------------------------------------------------
  1. chat_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (int) [INDEX]
  3. chat_type (enum('direct','group')) [DEFAULT: direct]
  4. created_by (int) [INDEX, NOT NULL]
  5. title (varchar(255))
  6. status (enum('active','closed','restricted','deleted')) [DEFAULT: active]
  7. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  8. updated_at (datetime) [DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP, DEFAULT: CURRENT_TIMESTAMP]
  9. is_important (tinyint(1)) [DEFAULT: 0]

  Foreign Keys:
    - created_by → users.user_id


## TABLE: master_services
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. service_name (varchar(255)) [NOT NULL]
  3. category_id (int)
  4. is_active (tinyint) [DEFAULT: 1]
  5. name (varchar(255))


## TABLE: master_status
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. role (varchar(50)) [DEFAULT: Admin]
  3. status_name (varchar(100)) [NOT NULL]
  4. is_active (tinyint) [DEFAULT: 1]


## TABLE: master_subjects
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. subject_name (varchar(255)) [NOT NULL]
  3. category_id (int)
  4. is_active (tinyint) [DEFAULT: 1]
  5. name (varchar(255))


## TABLE: master_urgency
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. assignment_urgency_type (varchar(150))
  3. is_active (int) [DEFAULT: 0]


## TABLE: notification_reminders
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. notification_id (int) [NOT NULL]
  3. user_id (int) [INDEX, NOT NULL]
  4. event_type (varchar(100)) [NOT NULL]
  5. reminder_count (int) [DEFAULT: 0]
  6. max_reminders (int) [DEFAULT: 4]
  7. interval_minutes (int) [DEFAULT: 30]
  8. last_sent_at (datetime)
  9. next_send_at (datetime) [INDEX]
  10. is_resolved (tinyint(1)) [DEFAULT: 0]
  11. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: notifications
--------------------------------------------------------------------------------
  1. notification_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. user_id (int) [INDEX, NOT NULL]
  3. type (varchar(50)) [DEFAULT: info]
  4. title (varchar(255)) [NOT NULL]
  5. message (text)
  6. is_read (tinyint) [DEFAULT: 0]
  7. link_url (varchar(255))
  8. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  9. reminder_count (int) [DEFAULT: 0]


## TABLE: orders
--------------------------------------------------------------------------------
  1. order_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. query_code (varchar(20)) [INDEX]
  3. order_code (varchar(20))
  4. user_id (int) [INDEX]
  5. paper_topic (varchar(255)) [NOT NULL]
  6. service (varchar(255)) [NOT NULL]
  7. subject (varchar(255)) [NOT NULL]
  8. urgency (varchar(50)) [NOT NULL]
  9. description (text)
  10. file_path (varchar(255))
  11. assignment_path (json)
  12. basic_price (decimal(10,2))
  13. discount (decimal(10,2)) [DEFAULT: 0.00]
  14. total_price (decimal(10,2))
  15. status (int) [INDEX, DEFAULT: 1]
  16. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  17. deadline_at (datetime)
  18. writers (json)
  19. grammarly_score (int)
  20. ai_score (int)
  21. plagiarism_score (int)
  22. words_used (int) [DEFAULT: 0]
  23. pages_used (int) [DEFAULT: 0]
  24. conversation_id (int)
  25. user_code (varchar(5))
  26. acceptance (tinyint) [DEFAULT: 0]
  27. work_code (varchar(20))
  28. orderscol (varchar(45))
  29. writer_id (int)
  30. updated_at (timestamp) [DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: orders_history
--------------------------------------------------------------------------------
  1. history_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (int) [INDEX, NOT NULL]
  3. modified_by (int)
  4. modified_by_name (varchar(100))
  5. modified_by_role (varchar(50))
  6. action_type (varchar(100))
  7. description (text)
  8. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  9. modified_date (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: password_reset_tokens
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. user_id (int) [INDEX, NOT NULL]
  3. token (varchar(255)) [UNIQUE, NOT NULL]
  4. expires_at (datetime) [NOT NULL]
  5. is_used (tinyint) [DEFAULT: 0]
  6. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: payments
--------------------------------------------------------------------------------
  1. payment_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (int)
  3. user_id (int)
  4. amount (decimal(10,2)) [NOT NULL]
  5. payment_method (varchar(50)) [NOT NULL]
  6. payment_type (varchar(45)) [NOT NULL]
  7. payment_doc (varchar(200))
  8. wallet_deduction (decimal(10,2)) [DEFAULT: 0.00]
  9. coupon_code (varchar(50))
  10. transaction_id (varchar(255))
  11. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: quotations
--------------------------------------------------------------------------------
  1. quotation_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (int) [INDEX, NOT NULL]
  3. user_id (int) [INDEX, NOT NULL]
  4. tax (decimal(10,2)) [DEFAULT: 0.00]
  5. discount (decimal(10,2)) [DEFAULT: 0.00]
  6. quoted_price (decimal(10,2)) [NOT NULL]
  7. notes (text)
  8. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: referal_amount
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL]
  2. referal_amount (int)
  3. bde_id (int)


## TABLE: referral_codes
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. code (varchar(50)) [UNIQUE, NOT NULL]
  3. bonus_amount (int) [NOT NULL]
  4. bde_id (int) [INDEX]
  5. created_by (int)
  6. max_uses (int)
  7. used_count (int) [DEFAULT: 0]
  8. expires_at (datetime)
  9. is_active (tinyint(1)) [DEFAULT: 1]
  10. created_at (timestamp) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  11. updated_at (timestamp) [DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: revision_requests
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (varchar(50)) [INDEX, NOT NULL]
  3. requested_by (int) [INDEX, NOT NULL]
  4. revision_number (int) [NOT NULL, DEFAULT: 1]
  5. reason (text) [NOT NULL]
  6. status (enum('pending','accepted','rejected','completed')) [INDEX, DEFAULT: pending]
  7. deadline (datetime)
  8. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  9. completed_at (datetime)

  Foreign Keys:
    - requested_by → users.user_id


## TABLE: service_categories
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. category_name (varchar(255)) [NOT NULL]
  3. is_active (tinyint) [DEFAULT: 1]


## TABLE: subject_categories
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. category_name (varchar(255)) [NOT NULL]
  3. is_active (tinyint) [DEFAULT: 1]


## TABLE: submissions
--------------------------------------------------------------------------------
  1. submission_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (int) [INDEX, NOT NULL]
  3. writer_id (int) [INDEX, NOT NULL]
  4. file_url (varchar(500)) [NOT NULL]
  5. grammarly_score (int)
  6. ai_score (int)
  7. plagiarism_score (int)
  8. status (enum('pending_qc','approved','revision_required','completed')) [DEFAULT: pending_qc]
  9. feedback (text)
  10. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  11. updated_at (datetime) [DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP, DEFAULT: CURRENT_TIMESTAMP]

  Foreign Keys:
    - order_id → orders.order_id


## TABLE: task_evaluations
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (int) [INDEX, NOT NULL]
  3. writer_id (int) [INDEX, NOT NULL]
  4. status (enum('pending','accepted','rejected','assigned','released')) [DEFAULT: pending]
  5. writer_status (enum('pending','accepted','rejected','in_progress','research_completed','writing_started','draft_submitted','rework_in_progress','completed')) [DEFAULT: pending]
  6. comment (text)
  7. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  8. updated_at (datetime) [DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP, DEFAULT: CURRENT_TIMESTAMP]

  Foreign Keys:
    - order_id → orders.order_id
    - writer_id → users.user_id


## TABLE: user_otps
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. email (varchar(255))
  3. mobile_number (varchar(20))
  4. otp (varchar(6))
  5. purpose (varchar(50))
  6. expires_at (datetime)
  7. is_used (tinyint(1)) [DEFAULT: 0]
  8. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]


## TABLE: users
--------------------------------------------------------------------------------
  1. user_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. full_name (varchar(255)) [NOT NULL]
  3. email (varchar(255)) [UNIQUE]
  4. mobile_number (varchar(20)) [NOT NULL]
  5. whatsapp (varchar(20)) [UNIQUE]
  6. university (varchar(500))
  7. currency_code (varchar(3)) [DEFAULT: USD]
  8. password_hash (varchar(255))
  9. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  10. role (varchar(10)) [DEFAULT: Client]
  11. bde (int)
  12. is_active (tinyint) [DEFAULT: 1]
  13. country (varchar(10))
  14. referal_code (varchar(45))
  15. is_verified (tinyint) [DEFAULT: 0]


## TABLE: wallet_transactions
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. user_id (int) [INDEX, NOT NULL]
  3. amount (decimal(10,2)) [NOT NULL]
  4. type (enum('credit','debit')) [NOT NULL]
  5. reason (varchar(100))
  6. reference_id (int)
  7. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]

  Foreign Keys:
    - user_id → users.user_id


## TABLE: wallets
--------------------------------------------------------------------------------
  1. wallet_id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. user_id (int) [UNIQUE, NOT NULL]
  3. balance (decimal(10,2)) [DEFAULT: 0.00]
  4. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]

  Foreign Keys:
    - user_id → users.user_id


## TABLE: writer_query_interest
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. order_id (int) [INDEX, NOT NULL]
  3. writer_id (int) [INDEX, NOT NULL]
  4. status (enum('invited','interested','accepted','rejected','assigned','revoked')) [DEFAULT: invited]
  5. comment (text)
  6. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  7. updated_at (datetime) [DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP, DEFAULT: CURRENT_TIMESTAMP]

  Foreign Keys:
    - order_id → orders.order_id
    - writer_id → users.user_id


## TABLE: writer_ratings
--------------------------------------------------------------------------------
  1. id (int) [PRIMARY KEY, NOT NULL, AUTO_INCREMENT]
  2. writer_id (int) [INDEX, NOT NULL]
  3. order_id (varchar(50)) [NOT NULL]
  4. client_id (int) [INDEX, NOT NULL]
  5. rating (int) [NOT NULL]
  6. review (text)
  7. created_at (datetime) [DEFAULT_GENERATED, DEFAULT: CURRENT_TIMESTAMP]
  8. updated_at (datetime) [DEFAULT_GENERATED ON UPDATE CURRENT_TIMESTAMP, DEFAULT: CURRENT_TIMESTAMP]

  Foreign Keys:
    - writer_id → users.user_id
    - client_id → users.user_id

================================================================================
