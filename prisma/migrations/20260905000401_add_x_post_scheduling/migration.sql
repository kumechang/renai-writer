-- AlterTable
ALTER TABLE "XPost" ADD COLUMN "feedbackAt" DATETIME;
ALTER TABLE "XPost" ADD COLUMN "feedbackBy" TEXT;
ALTER TABLE "XPost" ADD COLUMN "feedbackNotes" TEXT;

-- CreateTable
CREATE TABLE "XPostMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "xPostId" TEXT NOT NULL,
    "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impressions" INTEGER,
    "likes" INTEGER,
    "reposts" INTEGER,
    "replies" INTEGER,
    "bookmarks" INTEGER,
    "engagementRate" REAL,
    CONSTRAINT "XPostMetric_xPostId_fkey" FOREIGN KEY ("xPostId") REFERENCES "XPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostingTimeWeight" (
    "hour" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "reason" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "XPostMetric_xPostId_idx" ON "XPostMetric"("xPostId");
