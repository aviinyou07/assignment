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
-- Table structure for table `order_chats`
--

DROP TABLE IF EXISTS `order_chats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_chats` (
  `chat_id` int NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `context_code` varchar(50) DEFAULT NULL,
  `chat_name` varchar(255) DEFAULT 'General',
  `participants` json DEFAULT NULL,
  `messages` json DEFAULT NULL,
  `status` enum('active','restricted','closed') DEFAULT 'active',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`chat_id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_order_chats_context_code` (`context_code`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `order_chats`
--

LOCK TABLES `order_chats` WRITE;
/*!40000 ALTER TABLE `order_chats` DISABLE KEYS */;
INSERT INTO `order_chats` VALUES (1,1,NULL,'General','[1, 4, 6, 9]','[{\"name\": \"John Smith\", \"message\": \"Hi, I need help with this query\", \"user_id\": 1, \"timestamp\": \"2026-01-11 01:19:52.000000\"}, {\"name\": \"Raj Patel\", \"message\": \"Sure! Let me get a quotation for you\", \"user_id\": 4, \"timestamp\": \"2026-01-11 02:19:52.000000\"}]','active','2026-01-11 01:19:52','2026-01-11 17:18:10'),(2,2,NULL,'General','[2, 5, 7, 9]','[{\"name\": \"Sarah Johnson\", \"message\": \"Literature expertise needed\", \"user_id\": 2, \"timestamp\": \"2026-01-11 01:19:52.000000\"}]','active','2026-01-11 01:19:52','2026-01-11 17:18:10'),(3,3,NULL,'General','[3, 4, 8, 9]','[]','active','2026-01-11 01:19:52','2026-01-11 17:18:10');
/*!40000 ALTER TABLE `order_chats` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-01-13  6:47:29
