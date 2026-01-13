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
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `mobile_number` varchar(20) NOT NULL,
  `whatsapp` varchar(20) DEFAULT NULL,
  `university` varchar(500) DEFAULT NULL,
  `currency_code` varchar(3) DEFAULT 'USD',
  `password_hash` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `role` varchar(10) DEFAULT 'Client',
  `bde` int DEFAULT NULL,
  `is_active` tinyint DEFAULT '1',
  `country` varchar(10) DEFAULT NULL,
  `referal_code` varchar(45) DEFAULT NULL,
  `is_verified` tinyint DEFAULT '0',
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=52 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (39,'John Smith','client1@example.com','+1234567890','+1234567890','Harvard University','USD','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','client',NULL,1,'US',NULL,1),(40,'Sarah Johnson','client2@example.com','+9876543210','+9876543210','Oxford University','GBP','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','client',NULL,1,'GB',NULL,1),(41,'Ahmed Khan','client3@example.com','+923001234567','+923001234567','FAST University','PKR','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','client',NULL,1,'PK',NULL,1),(42,'Raj Patel','bde1@example.com','+919876543210','+919876543210','Delhi University','INR','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','bde',NULL,1,'IN',NULL,1),(43,'Emma Wilson','bde2@example.com','+441234567890','+441234567890','LSE','GBP','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','bde',NULL,1,'GB',NULL,1),(44,'Michael Brown','writer1@example.com','+13334445555','+13334445555','Stanford University','USD','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','writer',NULL,1,'US',NULL,1),(45,'Lisa Anderson','writer2@example.com','+442071234567','+442071234567','Cambridge University','GBP','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','writer',NULL,1,'GB',NULL,1),(46,'David Chen','writer3@example.com','+61298765432','+61298765432','University of Melbourne','AUD','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','writer',NULL,1,'AU',NULL,1),(47,'Admin User','admin@example.com','+1555666777','+1555666777','System Admin','USD','$2b$10$XOtRVEosoZQyzfJ/eDk0lOMfUudz6xpO/z8u3T6m3/H5Te1m6exgi','2026-01-11 01:19:52','admin',NULL,1,'US',NULL,1),(48,'Writer One','writer@a366.com','9000000001','9000000001','A366 University','INR','$2b$10$wzZIT4D1dmPR9/Hyo0wWD.ktyxb7Gtp8IbKIo/eJSfZuXNFOR.DsK','2026-01-11 01:25:23','writer',NULL,1,'IN','WRITER-A366',1),(49,'BDE One','bde@a366.com','9000000002','9000000002',NULL,'INR','$2b$10$HYuZZnu7nz7tKMjONjtVWOEDrrXIt4E24yEOeq6uy7j5mVkX9jeA.','2026-01-11 01:25:23','bde',NULL,1,'IN','BDE-A366',1),(50,'Admin One','admin@a366.com','9000000003','9000000003',NULL,'INR','$2b$10$5QMONc1Vl/gK/la5oA7JKetLWVs1UqQ8b6cNsIERQz5VPMTssNypS','2026-01-11 01:25:23','admin',NULL,1,'IN','ADMIN-A366',1),(51,'lokesh','lokeshkumawat5590@gmail.com','8302786174','','','USD','$2b$10$wzMeLhMWYRxXWn5HC9mHJ.wvym5qKQZ.MG/aFec5JlhdxEUAyxhmm','2026-01-12 12:06:19','client',NULL,1,'','A366UORIR0',1);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-01-13  7:08:41
