import { AnchorHTMLAttributes, lazy, Suspense } from 'react';
import { LinkProps, Link as ReactRouterLink, Route, Routes } from 'react-router';
import AdminLayout from './admin/AdminLayout.tsx';
import ConfigEditor from './admin/ConfigEditor.tsx';
import Dashboard from './admin/Dashboard.tsx';
import SettingsLayout from './admin/SettingsLayout.tsx';
import EarthStationDetail from './earth-stations/EarthStationDetail.tsx';
import FilingDetail from './filings/FilingDetail.tsx';
import { SettingsProvider } from './lib/settings-context.tsx';
import { ThemeProvider } from './lib/theme-provider.tsx';
import SatelliteDetail from './satellites/SatelliteDetail.tsx';
import SearchPage from './search/SearchPage.tsx';
import PublicLayout from './ui/PublicLayout.tsx';
import { AuthProvider } from './user/AuthContext.tsx';
import LoginPage from './user/LoginPage.tsx';
import ProfilePage from './user/ProfilePage.tsx';
import RequireAdmin from './user/RequireAdmin.tsx';
import RequireAuth from './user/RequireAuth.tsx';

const HomePage = lazy(() => import('./home/HomePage.tsx'));
const UserHomePage = lazy(() => import('./home/UserHomePage.tsx'));
const Companies = lazy(() => import('./admin/Companies.tsx'));
const Users = lazy(() => import('./admin/Users.tsx'));
const AiSettings = lazy(() => import('./admin/AiSettings.tsx'));
const InferenceCosts = lazy(() => import('./admin/InferenceCosts.tsx'));
const PipelinePage = lazy(() => import('./admin/pipeline/PipelinePage.tsx'));
const PipelineHistoryPage = lazy(() => import('./admin/pipeline/PipelineHistoryPage.tsx'));
const CompaniesPage = lazy(() => import('./companies/CompaniesPage.tsx'));
const CompanyDetail = lazy(() => import('./companies/CompanyDetail.tsx'));
const OwnershipEventsPage = lazy(() => import('./companies/OwnershipEventsPage.tsx'));
const NewsSourcesAdmin = lazy(() => import('./admin/NewsSourcesAdmin.tsx'));
const ConsultantAdmin = lazy(() => import('./admin/ConsultantAdmin.tsx'));
const HiddenItemsAdmin = lazy(() => import('./admin/HiddenItemsAdmin.tsx'));
const BackupsPage = lazy(() => import('./admin/BackupsPage.tsx'));
const EditionBrowser = lazy(() => import('./admin/newspaper/EditionBrowser.tsx'));
const EditionDetail = lazy(() => import('./admin/newspaper/EditionDetail.tsx'));
const PortraitLibrary = lazy(() => import('./admin/newspaper/PortraitLibrary.tsx'));
const NewspaperView = lazy(() => import('./newspaper/NewspaperView.tsx'));
const NewsDetail = lazy(() => import('./news/NewsDetail.tsx'));
const NewsPage = lazy(() => import('./news/NewsPage.tsx'));
const ChatPage = lazy(() => import('./chat/ChatPage.tsx'));
const AlertsPage = lazy(() => import('./alerts/AlertsPage.tsx'));
const LogsPage = lazy(() => import('./admin/LogsPage.tsx'));

const Link = ({ className, ...props }: LinkProps & AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <ReactRouterLink
    className={
      'text-accent-theme underline hover:no-underline' + (className ? ` ${className}` : '')
    }
    {...props}
  />
);

const About = () => (
  <div className="m-6 mx-auto w-8/12 rounded-theme border border-border-theme bg-surface-card p-4 shadow-md">
    <h1 className="text-4xl">
      <fbt desc="About">About</fbt>
    </h1>
    <p className="my-4">
      <Link to="/">
        <fbt desc="Back to home link">Home</fbt>
      </Link>
    </p>
  </div>
);

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <ThemeProvider>
          <Routes>
            <Route element={<LoginPage />} path="/login" />
            {/* All routes require authentication */}
            <Route
              element={
                <RequireAuth>
                  <PublicLayout />
                </RequireAuth>
              }
            >
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <HomePage />
                  </Suspense>
                }
                path="/"
              />
              <Route element={<About />} path="/about" />
              <Route element={<SearchPage />} path="/search" />
              <Route element={<FilingDetail />} path="/filings/*" />
              <Route element={<SatelliteDetail />} path="/satellites/:id" />
              <Route element={<EarthStationDetail />} path="/earth-stations/:callsign" />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <CompaniesPage />
                  </Suspense>
                }
                path="/companies"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <CompanyDetail />
                  </Suspense>
                }
                path="/companies/:id"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <OwnershipEventsPage />
                  </Suspense>
                }
                path="/ownership-events"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewsPage />
                  </Suspense>
                }
                path="/news"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <NewsDetail />
                  </Suspense>
                }
                path="/news/:id"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <ChatPage />
                  </Suspense>
                }
                path="/chat"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <AlertsPage />
                  </Suspense>
                }
                path="/alerts"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <UserHomePage />
                  </Suspense>
                }
                path="/filings/unread"
              />
              <Route element={<ProfilePage />} path="/profile" />
            </Route>
            {/* Full-page newspaper view (no AdminLayout) */}
            <Route
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <Suspense
                      fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}
                    >
                      <NewspaperView />
                    </Suspense>
                  </RequireAdmin>
                </RequireAuth>
              }
              path="/admin/newspaper/:date/view"
            />
            {/* Admin routes */}
            <Route
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <AdminLayout />
                  </RequireAdmin>
                </RequireAuth>
              }
              path="/admin"
            >
              <Route element={<Dashboard />} index />
              <Route element={<SettingsLayout />} path="settings">
                <Route element={<ConfigEditor />} index />
                <Route
                  element={
                    <Suspense
                      fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}
                    >
                      <AiSettings />
                    </Suspense>
                  }
                  path="ai"
                />
                <Route
                  element={
                    <Suspense
                      fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}
                    >
                      <NewsSourcesAdmin />
                    </Suspense>
                  }
                  path="news"
                />
                <Route
                  element={
                    <Suspense
                      fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}
                    >
                      <ConsultantAdmin />
                    </Suspense>
                  }
                  path="consultants"
                />
              </Route>
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <Companies />
                  </Suspense>
                }
                path="companies"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <Users />
                  </Suspense>
                }
                path="users"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <InferenceCosts />
                  </Suspense>
                }
                path="costs"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <PipelineHistoryPage />
                  </Suspense>
                }
                path="pipeline/history"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <PipelinePage />
                  </Suspense>
                }
                path="pipeline"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <HiddenItemsAdmin />
                  </Suspense>
                }
                path="hidden-items"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <BackupsPage />
                  </Suspense>
                }
                path="backups"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <EditionDetail />
                  </Suspense>
                }
                path="newspaper/:date"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <PortraitLibrary />
                  </Suspense>
                }
                path="newspaper/portraits"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <LogsPage />
                  </Suspense>
                }
                path="logs"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-on-surface-muted">Loading...</p>}>
                    <EditionBrowser />
                  </Suspense>
                }
                path="newspaper"
              />
            </Route>
          </Routes>
        </ThemeProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
