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
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `notification_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `type` varchar(50) DEFAULT 'info',
  `title` varchar(255) NOT NULL,
  `message` text,
  `is_read` tinyint DEFAULT '0',
  `link_url` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`notification_id`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
INSERT INTO `notifications` VALUES (1,1,'success','Quotation Sent','A quotation has been sent for your query QUERY_001',0,'/client/orders/1','2026-01-11 01:19:52'),(2,1,'success','Payment Verified','Your payment for order 1 has been verified! Work code: WORK_001ABC123XYZ',0,'/client/orders/1','2026-01-11 01:19:52'),(3,6,'success','Task Assigned','New task assigned: Climate Change and Global Warming Impact. Deadline: 2026-01-26',0,'/writer/tasks/1/detail','2026-01-11 01:19:52'),(4,6,'info','Task Submitted','Your work has been submitted for QC review',0,'/writer/tasks','2026-01-11 01:19:52'),(5,9,'info','New Submission for QC','New submission received for order 1 (QUERY_001)',1,'/admin/qc','2026-01-11 01:19:52'),(6,1,'success','Order Delivered','Your order is ready for download!',0,'/client/orders/1/delivery','2026-01-11 01:19:52'),(7,2,'success','Quotation Sent','A quotation has been sent for your query QUERY_002',0,'/client/orders/2','2026-01-11 01:19:52'),(8,3,'success','Quotation Sent','A quotation has been sent for your query QUERY_003',0,'/client/orders/3','2026-01-11 01:19:52'),(9,51,'success','Query Created Successfully','Your query (QUERY_08MJJORS) has been created. A BDE will send you a quotation soon.',0,'/client/queries/15','2026-01-12 12:43:05'),(10,47,'critical','New Query Received','New query created by lokesh: The Impact of Artificial Intelligence on Modern Healthcare',0,'/admin/queries/15','2026-01-12 12:43:05'),(11,51,'success','Query Created Successfully','Your query (QUERY_ZIW59FFC) has been created. A BDE will send you a quotation soon.',0,'/client/queries/16','2026-01-12 14:02:57'),(12,47,'critical','New Query Received','New query created by lokesh: The Impact of Artificial Intelligence on Modern Healthcare',0,'/admin/queries/16','2026-01-12 14:02:57');
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-01-13  6:47:27
