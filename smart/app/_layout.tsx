// app/_layout.tsx
import { Stack } from "expo-router";
import "../polyfills";

export default function RootLayout() {
  return (
    <Stack>
      {/* หน้าแรกของคุณ (ซ่อน header แต่ตั้ง title ให้ใช้กับปุ่ม Back) */}
      <Stack.Screen
        name="index"
        options={{ headerShown: false, title: "dashboard" }}
      />

      {/* ถ้ามีไฟล์ dashboard จริง ให้คงไว้หรือเอาออกตามโครงสร้างโปรเจกต์คุณ */}
      {/* <Stack.Screen name="dashboard" options={{ headerShown: false, title: "dashboard" }} /> */}

      {/* ✅ ซ่อนชื่อ sensor-detail/[key] ทั้งเว็บและมือถือ แต่ให้มีปุ่ม Back = "dashboard" */}
      <Stack.Screen
        name="sensor-detail/[key]"
        options={{
          headerShown: true,
          title: "",                 // กัน fallback เป็นชื่อไฟล์ route
          headerTitle: () => null,    // ไม่เรนเดอร์ตัวหนังสือบนกลาง header
          headerBackTitle: "dashboard",
        
        }}
      />
    </Stack>
  );
}
