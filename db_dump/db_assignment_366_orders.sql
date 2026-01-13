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
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `order_id` int NOT NULL AUTO_INCREMENT,
  `query_code` varchar(20) DEFAULT NULL,
  `order_code` varchar(20) DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `paper_topic` varchar(255) NOT NULL,
  `service` varchar(255) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `urgency` varchar(50) NOT NULL,
  `description` text,
  `file_path` varchar(255) DEFAULT NULL,
  `assignment_path` json DEFAULT NULL,
  `basic_price_usd` decimal(10,2) DEFAULT NULL,
  `discount_usd` decimal(10,2) DEFAULT '0.00',
  `total_price_usd` decimal(10,2) DEFAULT NULL,
  `status` int DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `deadline_at` datetime DEFAULT NULL,
  `writers` json DEFAULT NULL,
  `grammarly_score` int DEFAULT NULL,
  `ai_score` int DEFAULT NULL,
  `plagiarism_score` int DEFAULT NULL,
  `words_used` int DEFAULT '0',
  `pages_used` int DEFAULT '0',
  `conversation_id` int DEFAULT NULL,
  `user_code` varchar(5) DEFAULT NULL,
  `acceptance` tinyint DEFAULT '0',
  `work_code` varchar(20) DEFAULT NULL,
  `orderscol` varchar(45) DEFAULT NULL,
  `writer_id` int DEFAULT NULL,
  PRIMARY KEY (`order_id`),
  KEY `idx_query_code` (`query_code`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
INSERT INTO `orders` VALUES (12,'QUERY_001','ORD_001',1,'Climate Change and Global Warming Impact','Research Paper','Science','High','Need a comprehensive 15-page research paper on climate change',NULL,NULL,300.00,0.00,300.00,1,'2026-01-11 01:19:52','2026-01-26 01:19:52',NULL,NULL,NULL,NULL,0,0,NULL,'CLI01',0,NULL,NULL,NULL),(13,'QUERY_002','ORD_002',2,'British Literature in the Victorian Era','Academic Essay','English Literature','Medium','Essay on Victorian novels and their social impact',NULL,NULL,150.00,0.00,150.00,1,'2026-01-11 01:19:52','2026-01-31 01:19:52',NULL,NULL,NULL,NULL,0,0,NULL,'CLI02',0,NULL,NULL,NULL),(14,'QUERY_003','ORD_003',3,'Calculus Applications in Engineering','Homework Help','Mathematics','Urgent','10 homework problems solved with detailed explanations',NULL,NULL,75.00,0.00,75.00,1,'2026-01-11 01:19:52','2026-01-16 01:19:52',NULL,NULL,NULL,NULL,0,0,NULL,'CLI03',0,NULL,NULL,NULL),(15,'QUERY_08MJJORS',NULL,51,'The Impact of Artificial Intelligence on Modern Healthcare','essay_writing','Computer Science','High','I need a 3000-word essay discussing how AI is transforming healthcare, including current applications, ethical considerations, and future implications. The paper should include at least 10 recent academic sources and follow APA 7th edition formatting.',NULL,NULL,NULL,0.00,NULL,2,'2026-01-12 12:43:05','2026-01-25 00:00:00',NULL,NULL,NULL,NULL,0,0,NULL,NULL,0,NULL,NULL,NULL),(16,'QUERY_ZIW59FFC',NULL,51,'The Impact of Artificial Intelligence on Modern Healthcare','essay_writing','Computer Science','Urgent','I need a 3000-word essay discussing how AI is transforming healthcare, including current applications, ethical considerations, and future implications. The paper should include at least 10 recent academic sources and follow APA 7th edition formatting.',NULL,NULL,NULL,0.00,NULL,2,'2026-01-12 14:02:57','2026-01-25 00:00:00','[46, 45, 44]',NULL,NULL,NULL,0,0,NULL,NULL,0,NULL,NULL,NULL);
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
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
