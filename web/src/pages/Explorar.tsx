import CatalogSection from '../components/CatalogSection'
import DonorHeader from '../components/DonorHeader'
import PageShell from '../components/PageShell'

export default function Explorar() {
  return (
    <PageShell minHeight={1180}>
      <DonorHeader active="explorar" />
      <CatalogSection />
    </PageShell>
  )
}
