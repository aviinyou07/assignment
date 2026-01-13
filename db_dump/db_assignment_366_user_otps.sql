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
-- Table structure for table `user_otps`
--

DROP TABLE IF EXISTS `user_otps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_otps` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) DEFAULT NULL,
  `mobile_number` varchar(20) DEFAULT NULL,
  `otp` varchar(6) DEFAULT NULL,
  `purpose` varchar(50) DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `is_used` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_otps`
--

LOCK TABLES `user_otps` WRITE;
/*!40000 ALTER TABLE `user_otps` DISABLE KEYS */;
INSERT INTO `user_otps` VALUES (8,'aviinyou07@gmail.com',NULL,'339245','update_email','2026-01-09 23:39:27',1,'2026-01-09 23:34:26'),(9,'aviinyou07@gmail.com',NULL,'968129','update_email','2026-01-09 23:41:40',1,'2026-01-09 23:36:39'),(10,NULL,'7027888321','164788','update_mobile','2026-01-09 23:48:15',1,'2026-01-09 23:43:14'),(11,'deepak.ydv@myyahoo.com',NULL,'212692','update_password','2026-01-09 23:50:57',1,'2026-01-09 23:45:57'),(12,'writer@a366.com',NULL,'412270','update_password','2026-01-10 16:46:38',1,'2026-01-10 16:41:38'),(13,'writer@a366.com',NULL,'292763','update_password','2026-01-10 16:53:12',1,'2026-01-10 16:48:11'),(15,'lokeshkumawat5590@gmail.com',NULL,'401304','update_password','2026-01-12 12:18:35',0,'2026-01-12 12:13:35');
/*!40000 ALTER TABLE `user_otps` ENABLE KEYS */;
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
