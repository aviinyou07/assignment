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
-- Table structure for table `orders_history`
--

DROP TABLE IF EXISTS `orders_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders_history` (
  `history_id` int NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_by_name` varchar(100) DEFAULT NULL,
  `modified_by_role` varchar(50) DEFAULT NULL,
  `action_type` varchar(100) DEFAULT NULL,
  `description` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`history_id`),
  KEY `idx_order_id` (`order_id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders_history`
--

LOCK TABLES `orders_history` WRITE;
/*!40000 ALTER TABLE `orders_history` DISABLE KEYS */;
INSERT INTO `orders_history` VALUES (6,1,4,'Raj Patel','bde','QUOTATION_SENT','BDE sent quotation of $330.00','2026-01-11 01:19:52','2026-01-11 01:19:52'),(7,1,9,'Admin User','admin','PAYMENT_VERIFIED','Payment verified. Work code generated: WORK_001ABC123XYZ','2026-01-11 01:19:52','2026-01-11 01:19:52'),(8,1,9,'Admin User','admin','WRITER_ASSIGNED','Writer Michael Brown assigned to order','2026-01-11 01:19:52','2026-01-11 01:19:52'),(9,1,9,'Admin User','admin','SUBMISSION_APPROVED','Submission approved by QC','2026-01-11 01:19:52','2026-01-11 01:19:52'),(10,1,9,'Admin User','admin','ORDER_DELIVERED','Order delivered to client','2026-01-11 01:19:52','2026-01-11 01:19:52'),(11,2,5,'Emma Wilson','bde','QUOTATION_SENT','BDE sent quotation of $165.00','2026-01-11 01:19:52','2026-01-11 01:19:52'),(12,3,4,'Raj Patel','bde','QUOTATION_SENT','BDE sent urgent quotation of $82.50','2026-01-11 01:19:52','2026-01-11 01:19:52');
/*!40000 ALTER TABLE `orders_history` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-01-13  6:47:28
