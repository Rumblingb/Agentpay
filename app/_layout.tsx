import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: "#0d0d0d" }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: "#0d0d0d" } }} />
    </View>
  );
}
