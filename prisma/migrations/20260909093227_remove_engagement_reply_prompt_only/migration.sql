/*
  Warnings:

  - You are about to drop the `EngagementReply` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "WatchedPost" ADD COLUMN "githubIssueNumber" INTEGER;
ALTER TABLE "WatchedPost" ADD COLUMN "githubIssueOwner" TEXT;
ALTER TABLE "WatchedPost" ADD COLUMN "githubIssueRepo" TEXT;
ALTER TABLE "WatchedPost" ADD COLUMN "githubIssueUrl" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EngagementReply";
PRAGMA foreign_keys=on;
