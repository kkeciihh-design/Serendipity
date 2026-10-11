import { MapFrame } from "./map-frame";
import { requirePageAppAccess } from "@/lib/page-access";
export const dynamic = "force-dynamic";
export default async function MapFramePage() {
  await requirePageAppAccess();
  return <MapFrame />;
}
