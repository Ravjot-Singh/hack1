-- CreateEnum
CREATE TYPE "CoverAction" AS ENUM ('SUBSTITUTE', 'CANCEL');

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "periods" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cover" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "versionId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "action" "CoverAction" NOT NULL,
    "substituteId" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Absence_institutionId_date_idx" ON "Absence"("institutionId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Absence_institutionId_teacherId_date_key" ON "Absence"("institutionId", "teacherId", "date");

-- CreateIndex
CREATE INDEX "Cover_institutionId_date_idx" ON "Cover"("institutionId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Cover_institutionId_date_lessonId_key" ON "Cover"("institutionId", "date", "lessonId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cover" ADD CONSTRAINT "Cover_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
