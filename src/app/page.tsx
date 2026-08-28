import AuthGate from "@/components/AuthGate";
import MapApp from "@/components/MapApp";

export default function Home() {
  return (
    <AuthGate>
      <MapApp />
    </AuthGate>
  );
}
