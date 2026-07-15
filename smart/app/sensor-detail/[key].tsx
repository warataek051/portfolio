// SensorDetailScreen.tsx
import { useLocalSearchParams } from "expo-router";
import React from "react";
import {
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LineChart } from "react-native-chart-kit";

type HistoryPoint = {
  value: number;
  timestamp: string | number | Date;
  status?: "good" | "warn" | "danger" | string;
  analog?: number | null;
  digital?: boolean | null;
};

// -------- helpers: params & format --------
const asOne = (p: unknown) => (Array.isArray(p) ? p[0] : p);
const safeParse = <T,>(raw: unknown, fallback: T): T => {
  try {
    const s = asOne(raw);
    if (typeof s !== "string") return fallback;
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
const pad2 = (n: number) => n.toString().padStart(2, "0");
const fmt2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "-");
const timeStr = (t: any) =>
  new Date(t).toLocaleString("th-TH", { hour12: false });

const getDotColor = (s?: string) => {
  if (s === "good") return "#43A047";
  if (s === "warn") return "#FFD600";
  if (s === "danger") return "#F44336";
  return "#2f95dc";
};

export default function SensorDetailScreen() {
  const params = useLocalSearchParams();

  const label = (asOne(params.label) as string) || "Sensor";
  const unit = (asOne(params.unit) as string) || "";
  const sensorKey = (asOne(params.key) as string) || "";
  const showStatus = sensorKey !== "temperature" && sensorKey !== "humidity";

  const sensorHistory = React.useMemo<HistoryPoint[]>(
    () => safeParse<HistoryPoint[]>(params.sensorHistory, []),
    [params.sensorHistory]
  );
  const thresholds = React.useMemo(
    () => safeParse<Record<string, number>>(params.thresholds, {}),
    [params.thresholds]
  );

  const legendItems = React.useMemo(
    () => [
      { label: "ดี", color: "#43A047", description: "อยู่ในเกณฑ์ปลอดภัย" },
      { label: "ปานกลาง", color: "#FFD600", description: "เริ่มมีผลกระทบ ควรเฝ้าระวัง" },
      { label: "แย่", color: "#F44336", description: "มีความเสี่ยงสูง ควรป้องกัน" },
    ],
    []
  );

  // -------- chart size (responsive) --------
  const W = Dimensions.get("window").width;
  const H = 220;
  const PAD_H = 40; // padding แนวนอนโดยประมาณของ chart-kit
  const [chartW, setChartW] = React.useState(Math.max(280, W - 32));

  // -------- prepared data --------
  const labels = React.useMemo(
    () => sensorHistory.map(() => ""),
    [sensorHistory]
  );
  const values = React.useMemo(() => sensorHistory.map((d) => d.value), [sensorHistory]);
  const dotColors = React.useMemo(
    () => sensorHistory.map((d) => (showStatus ? getDotColor(d.status) : "#2f95dc")),
    [sensorHistory, showStatus]
  );

  const chartData = React.useMemo(
    () => ({ labels, datasets: [{ data: values }] }),
    [labels, values]
  );

  const latestLine = dotColors[dotColors.length - 1] || "#2f95dc";
  const chartConfig = {
    backgroundColor: "#fff",
    backgroundGradientFrom: "#fff",
    backgroundGradientTo: "#fff",
    decimalPlaces: 1,
    color: () => latestLine,
    labelColor: () => "#333",
    propsForDots: { r: "0" }, // วาด dot เอง
  };

  // -------- Tooltip (ลากดู) --------
  const [tooltip, setTooltip] = React.useState<{
    value: number;
    time: string;
    x: number;
    y: number;
    index: number;
  } | null>(null);

  const tooltipTimeout = React.useRef<any>(null);
  React.useEffect(() => {
    if (!tooltip) return;
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    tooltipTimeout.current = setTimeout(() => setTooltip(null), 3000);
    return () => tooltipTimeout.current && clearTimeout(tooltipTimeout.current);
  }, [tooltip]);

  // -------- Bottom sheet รายละเอียด --------
  const [detailIndex, setDetailIndex] = React.useState<number | null>(null);
  const showDetail = (idx: number) => setDetailIndex(idx);
  const hideDetail = () => setDetailIndex(null);

  const onReleaseOpenDetail = () => {
    if (tooltip?.index != null) showDetail(tooltip.index);
  };

  const onDataPointClick = (d: { index: number; value: number; x: number; y: number }) => {
    const idx = d.index;
    if (idx == null) return;
    setTooltip({
      value: values[idx],
      time: timeStr(sensorHistory[idx].timestamp),
      x: PAD_H + ((chartW - PAD_H * 2) * (idx / Math.max(1, values.length - 1))),
      y: d.y,
      index: idx,
    });
    showDetail(idx);
  };

  // map X (ลาก) → index
  function handleTouch(x: number) {
    const n = values.length;
    if (n === 0) return;
    const innerW = Math.max(1, chartW - PAD_H * 2);
    const xWithin = Math.max(0, Math.min(innerW, x - PAD_H));
    const step = innerW / Math.max(1, n - 1);
    const idx = Math.max(0, Math.min(n - 1, Math.round(xWithin / step)));
    const d = sensorHistory[idx];
    if (!d) return;

    const vmax = Math.max(...values, 1);
    const vmin = Math.min(...values, 0);
    const yrange = Math.max(1, vmax - vmin);
    const y = H - ((d.value - vmin) / yrange) * H;

    setTooltip({
      value: d.value,
      time: timeStr(d.timestamp),
      x: PAD_H + (innerW * (idx / Math.max(1, n - 1))),
      y,
      index: idx,
    });
  }

  // -------- stats --------
  const maxV = values.length ? Math.max(...values) : NaN;
  const minV = values.length ? Math.min(...values) : NaN;
  const avgV = values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {label} {unit ? `(${unit})` : ""}
      </Text>
      <Text style={styles.guide}>แตะ/ลากบนกราฟเพื่อดูรายละเอียด</Text>

      {/* กล่องห่อกราฟ (relative) */}
      <View
        style={styles.chartWrap}
        onLayout={(e) => setChartW(e.nativeEvent.layout.width)}
      >
        <LineChart
          data={chartData}
          width={chartW}
          height={H}
          chartConfig={chartConfig}
          style={styles.chart}
          bezier
          onDataPointClick={onDataPointClick}
          renderDotContent={({ x, y, index }) => (
            <View key={index} pointerEvents="none">
              <View
                style={{
                  position: "absolute",
                  left: x - 6.5,
                  top: y - 6.5,
                  width: 13,
                  height: 13,
                  borderRadius: 7,
                  backgroundColor: dotColors[index],
                  borderWidth: 2,
                  borderColor: "#fff",
                }}
              />
            </View>
          )}
        />

        {/* Overlay สำหรับลากดู (drag-to-inspect) */}
        <View
          style={[styles.inspectOverlay, { width: chartW, height: H }]}
          pointerEvents="auto"
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => handleTouch(e.nativeEvent.locationX)}
          onResponderMove={(e) => handleTouch(e.nativeEvent.locationX)}
          onResponderRelease={onReleaseOpenDetail}
        />
        {/* Tooltip ลอย */}
        {tooltip && (
          <View
            pointerEvents="none"
            style={[
              styles.tooltip,
              {
                left: Math.max(8, Math.min(chartW - 110, tooltip.x - 55)),
                top: Math.max(8, Math.min(H - 60, tooltip.y - 60)),
              },
            ]}
          >
            <Text style={styles.tooltipText}>
              ค่า: {fmt2(tooltip.value)} {unit}
            </Text>
            <Text style={styles.tooltipText}>เวลา: {tooltip.time}</Text>
            {showStatus &&
              typeof tooltip.index === "number" &&
              sensorHistory[tooltip.index]?.status && (
              <Text
                style={[
                  styles.tooltipText,
                  { color: dotColors[tooltip.index], fontWeight: "700" },
                ]}
              >
                สถานะ: {sensorHistory[tooltip.index].status}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Legend */}
      {showStatus && (
        <View style={styles.statusRow}>
          {legendItems.map((item) => (
            <View key={item.label} style={styles.legendChip}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <View>
                <Text style={[styles.legendLabel, { color: item.color }]}>{item.label}</Text>
                <Text style={styles.legendDesc}>{item.description}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Summary */}
      <View style={styles.summaryBox}>
        <Text style={styles.summaryTitle}>สรุปข้อมูลย้อนหลัง</Text>
        <Text style={styles.summaryText}>สูงสุด: {fmt2(maxV)} {unit}</Text>
        <Text style={styles.summaryText}>ต่ำสุด: {fmt2(minV)} {unit}</Text>
        <Text style={styles.summaryText}>เฉลี่ย: {fmt2(avgV)} {unit}</Text>
      </View>

      {/* Bottom Sheet รายละเอียด */}
      <Modal
        transparent
        visible={detailIndex !== null}
        animationType="slide"
        onRequestClose={hideDetail}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={hideDetail}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            {detailIndex !== null && (
              <DetailContent
                index={detailIndex}
                unit={unit}
                point={sensorHistory[detailIndex]}
                prev={sensorHistory[detailIndex - 1]}
                thresholds={thresholds}
                color={dotColors[detailIndex]}
                showStatus={showStatus}
                onClose={hideDetail}
              />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ---------- Sheet content ----------
function DetailContent({
  index, unit, point, prev, thresholds, color, showStatus, onClose,
}: {
  index: number;
  unit: string;
  point: HistoryPoint;
  prev?: HistoryPoint;
  thresholds: any;
  color: string;
  showStatus: boolean;
  onClose: () => void;
}) {
  const value = point?.value ?? NaN;
  const ts = point?.timestamp ? new Date(point.timestamp) : null;
  const delta = prev ? value - prev.value : NaN;
  const deltaSign = Number.isFinite(delta) ? (delta > 0 ? "+" : delta < 0 ? "−" : "±") : "";
  const deltaAbs = Number.isFinite(delta) ? Math.abs(delta).toFixed(2) : "-";
  const dtStr = ts ? ts.toLocaleString("th-TH", { hour12: false }) : "-";
  const sincePrev =
    prev && ts ? humanSince(new Date(prev.timestamp as any), ts) : "-";

  const statusLabel = showStatus
    ? point?.status === "good"
      ? "ดี"
      : point?.status === "warn"
      ? "ปานกลาง"
      : point?.status === "danger"
      ? "แย่"
      : "-"
    : null;
  const analog = typeof point?.analog === "number" && Number.isFinite(point.analog) ? point.analog : null;
  const digital = typeof point?.digital === "boolean" ? point.digital : null;

  return (
    <View>
      <View style={styles.sheetHandle} />
      <Text style={styles.sheetTitle}>รายละเอียดค่าที่เลือก</Text>

      <View style={styles.rowBetween}>
        <View>
          <Text style={styles.kvKey}>ค่า</Text>
          <Text style={styles.kvValue}>
            {Number.isFinite(value) ? value.toFixed(2) : "-"} {unit}
          </Text>
        </View>
        {showStatus && (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.kvKey}>สถานะ</Text>
            <Text style={[styles.badge, { backgroundColor: soft(color), color }]}>
              {statusLabel ?? "-"}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.kvBox}>
        <KV label="เวลา" value={dtStr} />
        <KV label="ลำดับจุด" value={`#${index + 1}`} />
        <KV label="เปลี่ยนจากครั้งก่อน" value={`${deltaSign}${deltaAbs} ${unit}`} />
        <KV label="ระยะห่างจากครั้งก่อน" value={sincePrev} />
        {analog !== null && <KV label="MQ-2 Analog" value={`${analog.toFixed(0)} / 4095`} />}
        {digital !== null && <KV label="MQ-2 Digital Alert" value={digital ? "แจ้งเตือน (LOW)" : "ปกติ"} />}
      </View>

      {!!thresholds && Object.keys(thresholds).length > 0 && (
        <View style={styles.kvBox}>
          <Text style={[styles.kvKey, { marginBottom: 6 }]}>เกณฑ์อ้างอิง</Text>
          {thresholds.good != null && <KV label="Good ≤" value={String(thresholds.good)} />}
          {thresholds.moderate != null && <KV label="Moderate ≤" value={String(thresholds.moderate)} />}
          {thresholds.warn != null && <KV label="Warn ≥" value={String(thresholds.warn)} />}
          {thresholds.danger != null && <KV label="Danger ≥" value={String(thresholds.danger)} />}
        </View>
      )}

      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeText}>ปิด</Text>
      </TouchableOpacity>
    </View>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValText}>{value}</Text>
    </View>
  );
}

function humanSince(a: Date, b: Date) {
  const ms = Math.max(0, +b - +a);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d} วัน`;
  if (h > 0) return `${h} ชม`;
  if (m > 0) return `${m} นาที`;
  return `${s} วินาที`;
}

function soft(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#eef2ff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number) => Math.round((c + 255 * 2) / 3);
  const rr = mix(r).toString(16).padStart(2, "0");
  const gg = mix(g).toString(16).padStart(2, "0");
  const bb = mix(b).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}

// -------- styles --------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", alignItems: "center", paddingTop: 24, paddingHorizontal: 16 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  guide: { fontSize: 13, color: "#888", marginBottom: 8 },

  chartWrap: { position: "relative", alignSelf: "stretch", borderRadius: 16 },
  chart: { borderRadius: 16 },
  inspectOverlay: { position: "absolute", left: 0, top: 0, zIndex: 10 },

  tooltip: {
    position: "absolute",
    backgroundColor: "#fff",
    padding: 8,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
    zIndex: 12,
    minWidth: 110,
  },
  tooltipText: { fontSize: 13, color: "#333" },

  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 14,
    marginBottom: 10,
  },
  legendChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginHorizontal: 6,
    marginVertical: 4,
    minWidth: 110,
  },
  legendDot: { width: 10, height: 10, borderRadius: 999, marginRight: 10 },
  legendLabel: { fontWeight: "700", fontSize: 13 },
  legendDesc: { fontSize: 11, color: "#64748b", marginTop: 2 },

  summaryBox: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    width: "90%",
    alignSelf: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  summaryTitle: { fontWeight: "bold", fontSize: 16, marginBottom: 6, color: "#2f95dc" },
  summaryText: { fontSize: 15, marginBottom: 2, color: "#333" },

  // bottom sheet
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "70%" },
  sheetHandle: { alignSelf: "center", width: 44, height: 5, borderRadius: 999, backgroundColor: "#e2e8f0", marginBottom: 10 },
  sheetTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  kvBox: { backgroundColor: "#f8fafc", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "#e2e8f0", marginTop: 6 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  kvKey: { fontSize: 13, color: "#64748b" },
  kvValue: { fontSize: 20, fontWeight: "800" },
  kvLabel: { fontSize: 14, color: "#334155" },
  kvValText: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontWeight: "800", overflow: "hidden" },
  closeBtn: { marginTop: 12, alignSelf: "center", backgroundColor: "#0ea5e9", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  closeText: { color: "#fff", fontWeight: "800" },
});
