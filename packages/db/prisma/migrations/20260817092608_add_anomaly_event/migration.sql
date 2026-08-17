-- CreateEnum
CREATE TYPE "AnomalyType" AS ENUM ('LATENCY_SPIKE', 'FLAPPING');

-- CreateTable
CREATE TABLE "anomaly_events" (
    "id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "type" "AnomalyType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "baseline" DOUBLE PRECISION NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anomaly_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "anomaly_events_monitor_id_detected_at_idx" ON "anomaly_events"("monitor_id", "detected_at" DESC);

-- AddForeignKey
ALTER TABLE "anomaly_events" ADD CONSTRAINT "anomaly_events_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

