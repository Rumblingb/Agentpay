import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ background: '#050505', color: '#e8e8e8' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto p-7">{children}</main>
      </div>
    </div>
  );
}
