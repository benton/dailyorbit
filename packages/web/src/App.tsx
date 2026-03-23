import { AnchorHTMLAttributes, lazy, Suspense } from 'react';
import { LinkProps, Link as ReactRouterLink, Route, Routes } from 'react-router';
import AdminLayout from './admin/AdminLayout.tsx';
import ConfigEditor from './admin/ConfigEditor.tsx';
import Dashboard from './admin/Dashboard.tsx';
import SettingsLayout from './admin/SettingsLayout.tsx';
import EarthStationDetail from './earth-stations/EarthStationDetail.tsx';
import FilingDetail from './filings/FilingDetail.tsx';
import { SettingsProvider } from './lib/settings-context.tsx';
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
const NewsDetail = lazy(() => import('./news/NewsDetail.tsx'));
const NewsPage = lazy(() => import('./news/NewsPage.tsx'));
const ChatPage = lazy(() => import('./chat/ChatPage.tsx'));
const AlertsPage = lazy(() => import('./alerts/AlertsPage.tsx'));

const Link = ({ className, ...props }: LinkProps & AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <ReactRouterLink
    className={
      'text-pink-700 underline hover:no-underline dark:text-pink-400' +
      (className ? ` ${className}` : '')
    }
    {...props}
  />
);

const About = () => (
  <div className="m-6 mx-auto w-8/12 rounded-sm border border-gray-200 p-4 shadow-md dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-none">
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
        <Routes>
          <Route element={<LoginPage />} path="/login" />
          {/* Public routes — no auth required */}
          <Route element={<PublicLayout />}>
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
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
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <CompaniesPage />
                </Suspense>
              }
              path="/companies"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <CompanyDetail />
                </Suspense>
              }
              path="/companies/:id"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <OwnershipEventsPage />
                </Suspense>
              }
              path="/ownership-events"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <NewsPage />
                </Suspense>
              }
              path="/news"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <NewsDetail />
                </Suspense>
              }
              path="/news/:id"
            />
            {/* Auth-required user pages */}
            <Route
              element={
                <RequireAuth>
                  <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                    <ChatPage />
                  </Suspense>
                </RequireAuth>
              }
              path="/chat"
            />
            <Route
              element={
                <RequireAuth>
                  <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                    <AlertsPage />
                  </Suspense>
                </RequireAuth>
              }
              path="/alerts"
            />
            <Route
              element={
                <RequireAuth>
                  <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                    <UserHomePage />
                  </Suspense>
                </RequireAuth>
              }
              path="/filings/unread"
            />
            <Route
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
              path="/profile"
            />
          </Route>
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
                  <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                    <AiSettings />
                  </Suspense>
                }
                path="ai"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                    <NewsSourcesAdmin />
                  </Suspense>
                }
                path="news"
              />
              <Route
                element={
                  <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                    <ConsultantAdmin />
                  </Suspense>
                }
                path="consultants"
              />
            </Route>
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <Companies />
                </Suspense>
              }
              path="companies"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <Users />
                </Suspense>
              }
              path="users"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <InferenceCosts />
                </Suspense>
              }
              path="costs"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <PipelineHistoryPage />
                </Suspense>
              }
              path="pipeline/history"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <PipelinePage />
                </Suspense>
              }
              path="pipeline"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <HiddenItemsAdmin />
                </Suspense>
              }
              path="hidden-items"
            />
            <Route
              element={
                <Suspense fallback={<p className="text-sm text-neutral-500">Loading...</p>}>
                  <BackupsPage />
                </Suspense>
              }
              path="backups"
            />
          </Route>
        </Routes>
      </SettingsProvider>
    </AuthProvider>
  );
}
