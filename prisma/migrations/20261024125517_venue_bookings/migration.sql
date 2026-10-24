-- CreateEnum
CREATE TYPE "BookingPriority" AS ENUM ('INSTITUTE', 'PLACEMENT', 'DEPARTMENT', 'CLUB');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "VenueBooking" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startPeriod" INTEGER NOT NULL,
    "endPeriod" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "attendees" INTEGER NOT NULL,
    "priority" "BookingPriority" NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "classOverride" BOOLEAN NOT NULL DEFAULT false,
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenueBooking_institutionId_date_idx" ON "VenueBooking"("institutionId", "date");

-- CreateIndex
CREATE INDEX "VenueBooking_institutionId_status_idx" ON "VenueBooking"("institutionId", "status");

-- AddForeignKey
ALTER TABLE "VenueBooking" ADD CONSTRAINT "VenueBooking_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueBooking" ADD CONSTRAINT "VenueBooking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
