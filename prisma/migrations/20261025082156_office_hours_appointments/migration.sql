-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED', 'INVALID');

-- CreateTable
CREATE TABLE "OfficeHours" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "slots" JSONB NOT NULL DEFAULT '[]',
    "slotMinutes" INTEGER NOT NULL DEFAULT 15,
    "perStudentWeek" INTEGER NOT NULL DEFAULT 2,
    "location" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "period" INTEGER NOT NULL,
    "offset" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficeHours_teacherId_key" ON "OfficeHours"("teacherId");

-- CreateIndex
CREATE INDEX "Appointment_institutionId_teacherId_date_idx" ON "Appointment"("institutionId", "teacherId", "date");

-- CreateIndex
CREATE INDEX "Appointment_institutionId_studentId_idx" ON "Appointment"("institutionId", "studentId");

-- AddForeignKey
ALTER TABLE "OfficeHours" ADD CONSTRAINT "OfficeHours_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
