-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: localhost    Database: db_assignment_366
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `event_type` varchar(100) NOT NULL,
  `event_data` json DEFAULT NULL,
  `resource_type` varchar(50) DEFAULT NULL,
  `resource_id` varchar(50) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `action` varchar(100) DEFAULT NULL,
  `details` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,1,'QUERY_CREATED',NULL,'order','1','192.168.1.1','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Client created query QUERY_001'),(2,4,'QUOTATION_SENT',NULL,'quotation','1','192.168.1.2','Mozilla/5.0','2026-01-11 01:19:52',NULL,'BDE created quotation for order 1'),(3,1,'QUOTATION_ACCEPTED',NULL,'quotation','1','192.168.1.1','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Client accepted quotation'),(4,1,'PAYMENT_UPLOADED',NULL,'payment','1','192.168.1.1','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Client uploaded payment receipt'),(5,9,'PAYMENT_VERIFIED',NULL,'payment','1','192.168.1.3','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Admin verified payment, generated work_code'),(6,9,'WRITER_ASSIGNED',NULL,'order','1','192.168.1.3','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Admin assigned writer 6 to order 1'),(7,6,'TASK_EVALUATED',NULL,'task_evaluation','1','192.168.1.4','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Writer 6 accepted task for order 1'),(8,6,'WORK_SUBMITTED_FOR_QC',NULL,'submission','1','192.168.1.4','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Writer 6 submitted work for QC'),(9,9,'SUBMISSION_APPROVED',NULL,'submission','1','192.168.1.3','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Admin approved submission for order 1'),(10,9,'ORDER_DELIVERED',NULL,'order','1','192.168.1.3','Mozilla/5.0','2026-01-11 01:19:52',NULL,'Admin delivered order 1 to client'),(11,51,'QUERY_CREATED','{\"service\": \"essay_writing\", \"subject\": \"Computer Science\", \"urgency\": \"72_hours\", \"query_code\": \"QUERY_08MJJORS\", \"paper_topic\": \"The Impact of Artificial Intelligence on Modern Healthcare\"}','order','15','::1','PostmanRuntime/7.51.0','2026-01-12 12:43:05','QUERY_CREATED','Client created query with code: QUERY_08MJJORS'),(12,51,'QUERY_CREATED','{\"service\": \"essay_writing\", \"subject\": \"Computer Science\", \"urgency\": \"Urgent\", \"query_code\": \"QUERY_ZIW59FFC\", \"paper_topic\": \"The Impact of Artificial Intelligence on Modern Healthcare\"}','order','16','::1','PostmanRuntime/7.51.0','2026-01-12 14:02:57','QUERY_CREATED','Client created query with code: QUERY_ZIW59FFC');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-01-13  6:47:32
