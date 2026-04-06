import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native";
import { AppShell } from "./src/AppShell";
import { theme } from "./src/theme";

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <StatusBar style="dark" />
      <AppShell />
    </SafeAreaView>
  );
}
