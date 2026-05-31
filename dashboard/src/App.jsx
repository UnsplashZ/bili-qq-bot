import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Groups from './pages/Groups';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AgentSettings from './pages/AgentSettings';
import AgentDecisions from './pages/AgentDecisions';
import AgentMemory from './pages/AgentMemory';
import PreviewLayoutEditor from './pages/PreviewLayoutEditor';
import ProtectedRoute from './components/ProtectedRoute';
import { ToastProvider } from './components/ToastProvider';
import ThemeProvider from './components/ThemeProvider';

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Dashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/groups"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Groups />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Settings />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/logs"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Logs />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/preview-layout"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PreviewLayoutEditor />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/agent-settings"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AgentSettings />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/agent-decisions"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AgentDecisions />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/agent-memory"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AgentMemory />
                  </Layout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Router>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
