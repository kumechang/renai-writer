/*
  Warnings:

  - You are about to drop the column `xUserId` on the `WatchedAccount` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WatchedAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_WatchedAccount" ("active", "createdAt", "id", "note", "updatedAt", "username") SELECT "active", "createdAt", "id", "note", "updatedAt", "username" FROM "WatchedAccount";
DROP TABLE "WatchedAccount";
ALTER TABLE "new_WatchedAccount" RENAME TO "WatchedAccount";
CREATE UNIQUE INDEX "WatchedAccount_username_key" ON "WatchedAccount"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
