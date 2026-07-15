// DashboardCard.tsx
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

/** ---------- Types ---------- */
interface AirQualityData {
  temperature: number | null; // °C
  humidity: number | null; // %
  pm25: number | null; // µg/m³
  pm10: number | null; // µg/m³
  smoke: number | null; // MQ-2 ppm
  mq2Analog?: number | null; // raw ADC (0-4095)
  mq2Digital?: boolean | null; // digital alert
  timestamp: Date | string;
}

/** ---------- Thresholds (DEMO) ---------- */
const AQ_THRESHOLDS = {
  pm25: { good: 25, moderate: 50 },
  pm10: { good: 50, moderate: 100 },
  smoke: { warn: 150, danger: 300 },
};

/** ---------- Design tokens ---------- */
const PALETTE = {
  surface: '#f8fafc',
  card: '#ffffff',
  text: '#0f172a',
  textDim: '#64748b',
  border: '#e2e8f0',
  primary: '#0ea5e9',
  primarySoft: '#e0f2fe',
  success: '#43A047',
  warn: '#FFD600',
  danger: '#F44336',
};

type Level = 'good' | 'warn' | 'danger';
const STATUS_LABELS: Record<Level, string> = {
  good: 'ดี',
  warn: 'ปานกลาง',
  danger: 'แย่',
};

/** ---------- Utils ---------- */
const fmt1 = (n?: number | null) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '--';
const formatTH = (d?: Date | string) =>
  d ? new Date(d).toLocaleString('th-TH', { hour12: false }) : '-';
const levelColor = (lvl: Level) =>
  lvl === 'danger' ? PALETTE.danger : lvl === 'warn' ? PALETTE.warn : PALETTE.success;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const gradeByTwo = (v: number, goodMax: number, moderateMax: number): Level => {
  if (v <= goodMax) return 'good';
  if (v <= moderateMax) return 'warn';
  return 'danger';
};
const gradeByWarnDanger = (v: number, warn: number, danger: number): Level => {
  if (v >= danger) return 'danger';
  if (v >= warn) return 'warn';
  return 'good';
};
function soft(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#eef2ff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number) => Math.round((c + 255 * 2) / 3);
  const rr = mix(r).toString(16).padStart(2, '0');
  const gg = mix(g).toString(16).padStart(2, '0');
  const bb = mix(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

/** ---------- ช่วยคำนวณสถานะตามชนิด ---------- */
type SensorKey = 'pm25' | 'pm10' | 'smoke' | 'temperature' | 'humidity';
function levelFor(key: 'pm25' | 'pm10' | 'smoke', value?: number | null): Level {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'good';
  const t: any = (AQ_THRESHOLDS as any)[key];
  if (!t) return 'good';
  if (t.good !== undefined && t.moderate !== undefined) {
    if (value <= t.good) return 'good';
    if (value <= t.moderate) return 'warn';
    return 'danger';
  }
  if (t.warn !== undefined && t.danger !== undefined) {
    if (value >= t.danger) return 'danger';
    if (value >= t.warn) return 'warn';
    return 'good';
  }
  return 'good';
}

/** ---------- Small UI blocks ---------- */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}
function StatusChip({ level }: { level: Level }) {
  return (
    <View style={[styles.chip, { backgroundColor: soft(levelColor(level)) }]}>
      <View style={[styles.dot, { backgroundColor: levelColor(level) }]} />
      <Text style={[styles.chipText, { color: levelColor(level) }]}>
        อากาศ{STATUS_LABELS[level]}
      </Text>
    </View>
  );
}
const StatCell = ({
  label, value, unit, tint,
}: { label: string; value?: number | null; unit: string; tint?: string }) => (
  <View style={styles.cell}>
    <Text style={styles.cellLabel}>{label}</Text>
    <Text style={[styles.cellValue, { color: tint ?? PALETTE.primary }]}>{fmt1(value)}</Text>
    <Text style={styles.cellUnit}>{unit}</Text>
  </View>
);

/** ---------- Props ---------- */
interface DashboardCardProps {
  data: AirQualityData | null;
  history: AirQualityData[];
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'error';
}

/** ---------- Main ---------- */
export default function DashboardCard({
  data,
  history,
  connectionStatus,
}: DashboardCardProps) {
  const router = useRouter();
  const connectionText = connectionStatus
    ? connectionStatus === 'connected'
      ? 'MQTT: เชื่อมต่อแล้ว'
      : connectionStatus === 'error'
      ? 'MQTT: มีปัญหาการเชื่อมต่อ'
      : connectionStatus === 'reconnecting'
      ? 'MQTT: กำลังเชื่อมต่อใหม่...'
      : 'MQTT: กำลังเชื่อมต่อ...'
    : null;
  const connectionColor = connectionStatus === 'connected'
    ? PALETTE.success
    : connectionStatus === 'error'
    ? PALETTE.danger
    : '#f97316';

  const sensorMeta: Record<SensorKey, { label: string; unit: string; thresholds?: any }> = {
    pm25: { label: 'PM2.5', unit: 'µg/m³', thresholds: AQ_THRESHOLDS.pm25 },
    pm10: { label: 'PM10', unit: 'µg/m³', thresholds: AQ_THRESHOLDS.pm10 },
  smoke: { label: 'MQ-2 (PPM)', unit: 'ppm', thresholds: AQ_THRESHOLDS.smoke },
    temperature: { label: 'อุณหภูมิ', unit: '°C' },
    humidity: { label: 'ความชื้น', unit: '%' },
  };

  /** ---------- ไปหน้ารายละเอียด (กราฟ) ---------- */
  const goToDetail = (key: SensorKey) => {
    const meta = sensorMeta[key];

    // คำนวณสถานะจุดจาก thresholds (เพื่อให้สีจุด "คงเดิม")
    const sensorHistoryWithStatus = history.map(d => {
      let status: 'good' | 'warn' | 'danger' | undefined;
      const t = meta.thresholds;
      const rawValue = (d as any)[key] as number | null;
      const v = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;

      if (t && v !== null) {
        if (t.good !== undefined && t.moderate !== undefined) {
          status = v <= t.good ? 'good' : v <= t.moderate ? 'warn' : 'danger';
        } else if (t.warn !== undefined && t.danger !== undefined) {
          status = v >= t.danger ? 'danger' : v >= t.warn ? 'warn' : 'good';
        }
      }
      const extra: Record<string, any> = {};
      if (key === 'smoke') {
        extra.analog = (d as any).mq2Analog ?? null;
        extra.digital = (d as any).mq2Digital ?? null;
      }
      const point: Record<string, any> = { value: v ?? 0, timestamp: d.timestamp, ...extra };
      if (status) {
        point.status = status;
      }
      return point;
    });

    // ⛔️ ไม่ส่ง thresholds ไปหน้า detail อีกแล้ว
    router.push({
      pathname: '/sensor-detail/[key]',
      params: {
        key,
        label: meta.label,
        unit: meta.unit,
        sensorHistory: JSON.stringify(sensorHistoryWithStatus),
      },
    });
  };

  /** ---------- ภาพรวมคุณภาพอากาศ (ใช้เฉพาะ PM2.5/PM10) ---------- */
  const OVERALL_KEYS_PM: Array<'pm25' | 'pm10'> = ['pm25', 'pm10'];
  const overall = useMemo(() => {
    if (!data) return { level: 'good' as Level, culprit: null as 'pm25' | 'pm10' | null };
    const rows = OVERALL_KEYS_PM
      .map((k) => {
        const value = (data as any)[k] as number | null;
        return { k, v: value, level: levelFor(k, value) };
      })
      .filter((r): r is { k: 'pm25' | 'pm10'; v: number; level: Level } => isFiniteNumber(r.v));
    if (!rows.length) return { level: 'good' as Level, culprit: null };
    const priority = (lv: Level) => (lv === 'danger' ? 3 : lv === 'warn' ? 2 : 1);
    const worst = rows.reduce((a, b) => (priority(b.level) > priority(a.level) ? b : a));
    return { level: worst.level, culprit: worst.k };
  }, [data]);

  /** ---------- คำเตือนก๊าซ (แสดงแยก) ---------- */
  const GAS_KEYS: Array<'smoke'> = ['smoke'];
  const gasAlerts = useMemo(() => {
    if (!data) return [] as Array<{ k: 'smoke'; v: number; level: Level }>;
    return GAS_KEYS
      .map((k) => {
        const value = (data as any)[k] as number | null;
        return { k, v: value, level: levelFor(k, value) };
      })
      .filter((r): r is { k: 'smoke'; v: number; level: Level } =>
        isFiniteNumber(r.v) && (r.level === 'warn' || r.level === 'danger')
      );
  }, [data]);

  /** ---------- ข้อมูลบนการ์ดสรุป ---------- */
  const hasData = !!data && history.length > 0;
  const pm25Value = isFiniteNumber(data?.pm25) ? (data!.pm25 as number) : null;
  const pm10Value = isFiniteNumber(data?.pm10) ? (data!.pm10 as number) : null;
  const smokeValue = isFiniteNumber(data?.smoke) ? (data!.smoke as number) : null;

  const pm25Level = pm25Value !== null ? gradeByTwo(pm25Value, AQ_THRESHOLDS.pm25.good, AQ_THRESHOLDS.pm25.moderate) : 'good';
  const pm10Level = pm10Value !== null ? gradeByTwo(pm10Value, AQ_THRESHOLDS.pm10.good, AQ_THRESHOLDS.pm10.moderate) : 'good';
  const smokeLevel = smokeValue !== null ? gradeByWarnDanger(smokeValue, AQ_THRESHOLDS.smoke.warn, AQ_THRESHOLDS.smoke.danger) : 'good';

  const pm25Tint = pm25Value !== null ? levelColor(pm25Level) : PALETTE.primary;
  const pm10Tint = pm10Value !== null ? levelColor(pm10Level) : PALETTE.primary;
  const smokeTint = smokeValue !== null ? levelColor(smokeLevel) : PALETTE.primary;

  const histPM25 = history.map((d) => d.pm25).filter(isFiniteNumber);
  const minPM25 = histPM25.length ? Math.min(...histPM25) : undefined;
  const maxPM25 = histPM25.length ? Math.max(...histPM25) : undefined;

  const summaryText =
    overall.level === 'danger'
      ? 'ภาพรวม PM อยู่ในระดับแย่ ควรหลีกเลี่ยงกิจกรรมกลางแจ้งและปิดหน้าต่าง'
      : overall.level === 'warn'
      ? 'ภาพรวม PM อยู่ในระดับปานกลาง ควรระวังสำหรับผู้มีโรคประจำตัว'
      : 'ภาพรวม PM อยู่ในระดับดี เหมาะสำหรับกิจกรรมกลางแจ้ง';

  const overallReason = overall.culprit
    ? `${overall.culprit.toUpperCase()} = ${fmt1((data as any)[overall.culprit])} ${
        overall.culprit === 'pm25' || overall.culprit === 'pm10' ? 'µg/m³' : ''
      }`
    : '';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 28 }}>
      {/* HERO / SUMMARY */}
      <View style={styles.hero}>
        <StatusChip level={overall.level} />
        {connectionText && (
          <Text style={[styles.connectionText, { color: connectionColor }]}>{connectionText}</Text>
        )}
        <Text style={styles.heroTitle}>ข้อมูลล่าสุด</Text>

        {hasData ? (
          <>
            <Text style={styles.heroLine}>
              PM2.5{' '}
              <Text style={{ color: levelColor(pm25Level), fontWeight: '800' }}>
                {fmt1(pm25Value)}
              </Text>{' '}
              µg/m³
            </Text>
            <Text style={styles.heroLine}>
              วัดเมื่อ: <Text style={{ fontWeight: '700' }}>{formatTH(data!.timestamp)}</Text>
            </Text>
            <View style={styles.heroMinmax}>
              <Text style={[styles.miniStat, { color: PALETTE.success }]}>ต่ำสุด: {fmt1(minPM25)}</Text>
              <Text style={styles.pipe}>|</Text>
              <Text style={[styles.miniStat, { color: PALETTE.danger }]}>สูงสุด: {fmt1(maxPM25)}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.heroLine}>ไม่มีข้อมูล</Text>
        )}

        <View style={styles.heroNote}>
          <Text style={styles.heroNoteText}>{summaryText}</Text>
          {!!overallReason && (
            <Text style={[styles.heroNoteText, { color: PALETTE.textDim, marginTop: 4 }]}>
              เหตุผลภาพรวม: {overallReason}
            </Text>
          )}
        </View>

        {/* คำเตือนก๊าซ (ไม่กระทบภาพรวม PM) */}
        {gasAlerts.length > 0 && (
          <View style={[styles.heroNote, { marginTop: 8, backgroundColor: '#fff7ed', borderColor: '#fed7aa' }]}>
            <Text style={[styles.heroNoteText, { color: '#9a3412', fontWeight: '800' }]}>คำเตือนก๊าซ</Text>
            {gasAlerts.map((a) => (
              <Text key={a.k} style={[styles.heroNoteText, { color: a.level === 'danger' ? '#b91c1c' : '#9a3412' }]}>
                • {(sensorMeta as any)[a.k]?.label ?? a.k.toUpperCase()} = {fmt1((data as any)[a.k])} ppm — {a.level === 'danger' ? 'อันตราย' : 'ปานกลาง'}
              </Text>
            ))}
          </View>
        )}
        {data?.mq2Digital === true && (
          <View style={[styles.heroNote, { marginTop: 8, backgroundColor: '#fee2e2', borderColor: '#fca5a5' }]}>
            <Text style={[styles.heroNoteText, { color: '#b91c1c', fontWeight: '800' }]}>MQ-2 Digital Alert</Text>
            <Text style={[styles.heroNoteText, { color: '#b91c1c' }]}>เซ็นเซอร์ MQ-2 ตรวจพบก๊าซเกินค่า threshold (สัญญาณ DO เป็น LOW)</Text>
          </View>
        )}
      </View>

      {/* DASHBOARD */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <SectionTitle>📊 Dashboard</SectionTitle>
          <Text style={styles.sectionSub}>แตะการ์ดเพื่อดูรายละเอียดแบบกราฟ</Text>
        </View>

        {/* Top: Temp/Humidity */}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.topBox, { marginRight: 8 }]} onPress={() => goToDetail('temperature')} activeOpacity={0.85}>
            <Text style={styles.topLabel}>อุณหภูมิ</Text>
            <Text style={styles.topValue}>{fmt1(data?.temperature)}</Text>
            <Text style={styles.topUnit}>°C</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.topBox, { marginLeft: 8 }]} onPress={() => goToDetail('humidity')} activeOpacity={0.85}>
            <Text style={styles.topLabel}>ความชื้น</Text>
            <Text style={styles.topValue}>{fmt1(data?.humidity)}</Text>
            <Text style={styles.topUnit}>%</Text>
          </TouchableOpacity>
        </View>

        {/* Grid sensors */}
        <View style={{ marginTop: 8 }}>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.half, { marginRight: 8 }]} onPress={() => goToDetail('pm25')} activeOpacity={0.85}>
              <StatCell
                label="PM2.5"
                value={data?.pm25}
                unit="µg/m³"
                tint={pm25Tint}
              />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.half, { marginLeft: 8 }]} onPress={() => goToDetail('pm10')} activeOpacity={0.85}>
              <StatCell
                label="PM10"
                value={data?.pm10}
                unit="µg/m³"
                tint={pm10Tint}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.half} onPress={() => goToDetail('smoke')} activeOpacity={0.85}>
              <StatCell
                label="MQ-2 (PPM)"
                value={data?.smoke}
                unit="ppm"
                tint={smokeTint}
              />
            </TouchableOpacity>
          </View>
        </View>

      </View>

    </ScrollView>
  );
}

/** ---------- Styles ---------- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PALETTE.surface, padding: 16 },

  /** HERO */
  hero: {
    backgroundColor: PALETTE.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.border,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 16,
    alignItems: 'center',
  },
  connectionText: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: PALETTE.text, marginTop: 6, marginBottom: 6 },
  heroLine: { fontSize: 15, color: PALETTE.text, marginTop: 2 },
  heroMinmax: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  miniStat: { fontSize: 13, fontWeight: '700' },
  pipe: { marginHorizontal: 8, color: PALETTE.textDim },
  heroNote: { backgroundColor: PALETTE.primarySoft, borderColor: '#bae6fd', borderWidth: 1, padding: 10, borderRadius: 12, marginTop: 10, width: '100%' },
  heroNoteText: { color: PALETTE.text, fontSize: 13 },

  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: PALETTE.border },
  chipText: { fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 999, marginRight: 8 },

  /** SECTION */
  sectionCard: { backgroundColor: PALETTE.card, borderRadius: 16, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: PALETTE.border, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 1 },
  sectionHeader: { marginBottom: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: PALETTE.text },
  sectionSub: { color: PALETTE.textDim, marginTop: 2 },

  /** LAYOUT ROWS */
  row: { flexDirection: 'row', marginTop: 8 },

  /** TOP METRICS */
  topBox: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', borderWidth: 1, borderColor: PALETTE.border },
  topLabel: { color: PALETTE.textDim, fontSize: 13, marginBottom: 2 },
  topValue: { fontSize: 26, fontWeight: '800', color: PALETTE.text },
  topUnit: { color: PALETTE.textDim, fontSize: 12, marginTop: 2 },

  /** GRID CELLS */
  half: { flex: 1 },
  cell: { flex: 1, backgroundColor: '#f8fafc', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: PALETTE.border },
  cellLabel: { fontSize: 13, color: PALETTE.textDim, marginBottom: 4 },
  cellValue: { fontSize: 24, fontWeight: '800', letterSpacing: 0.3 },
  cellUnit: { fontSize: 12, color: PALETTE.textDim, marginTop: 2 },
});
