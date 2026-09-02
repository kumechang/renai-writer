/*
  Warnings:

  - You are about to drop the column `planId` on the `Draft` table. All the data in the column will be lost.
  - You are about to drop the column `recommendedTitle` on the `Plan` table. All the data in the column will be lost.
  - You are about to drop the column `selectedTitle` on the `Plan` table. All the data in the column will be lost.
  - Added the required column `articleId` to the `Draft` table without a default value. This is not possible if the table is not empty.
  - Added the required column `recommendedTitles` to the `Plan` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "IssueSession" ADD COLUMN "articleId" TEXT;

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Article_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Draft_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Draft" ("content", "createdAt", "id", "revisionNumber", "title", "wordCount") SELECT "content", "createdAt", "id", "revisionNumber", "title", "wordCount" FROM "Draft";
DROP TABLE "Draft";
ALTER TABLE "new_Draft" RENAME TO "Draft";
CREATE INDEX "Draft_articleId_idx" ON "Draft"("articleId");
CREATE TABLE "new_Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "theme" TEXT NOT NULL,
    "targetReader" TEXT NOT NULL,
    "structure" TEXT NOT NULL,
    "volume" TEXT NOT NULL,
    "paidSection" TEXT NOT NULL,
    "titleCandidates" TEXT NOT NULL,
    "recommendedTitles" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Plan" ("createdAt", "id", "paidSection", "status", "structure", "targetReader", "theme", "titleCandidates", "updatedAt", "volume") SELECT "createdAt", "id", "paidSection", "status", "structure", "targetReader", "theme", "titleCandidates", "updatedAt", "volume" FROM "Plan";
DROP TABLE "Plan";
ALTER TABLE "new_Plan" RENAME TO "Plan";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Article_planId_idx" ON "Article"("planId");
