import { requirePageAppAccess } from "@/lib/page-access";
import { HomeGallery } from "./components/home-gallery";

export default async function HomePage() {
  await requirePageAppAccess();
  return <HomeGallery />;
}
