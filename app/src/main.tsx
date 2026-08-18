import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import './styles.css';
import { AuthProvider } from './auth/AuthProvider.js';
import { Masthead } from './components/Masthead.js';
import { BoardPage } from './routes/BoardPage.js';
import { Callback } from './routes/Callback.js';
import { Home } from './routes/Home.js';
import { SettingsPage } from './routes/SettingsPage.js';
import './boards/tasks/index.js';
import './boards/checklist/index.js';
import './boards/text/index.js';
import './boards/link/index.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/** The old members-page URL — kept working as a redirect for any existing bookmarks/links. */
function MembersRedirect() {
  const { householdId } = useParams<{ householdId: string }>();
  return <Navigate to={`/households/${householdId}/settings`} replace />;
}

function App() {
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);

  return (
    <Masthead selectedHouseholdId={selectedHouseholdId} onSelectHousehold={setSelectedHouseholdId}>
      <Routes>
        <Route path="/" element={<Home selectedHouseholdId={selectedHouseholdId} />} />
        <Route path="/callback" element={<Callback />} />
        <Route path="/households/:householdId/boards/:boardId" element={<BoardPage />} />
        <Route path="/households/:householdId/settings" element={<SettingsPage />} />
        <Route path="/households/:householdId/members" element={<MembersRedirect />} />
      </Routes>
    </Masthead>
  );
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
