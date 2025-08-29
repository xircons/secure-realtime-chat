import './App.css'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import Login from './components/Login.jsx'
import Dashboard from './components/Dashboard.jsx'

function AppInner() {
  const { user } = useAuth()
  return user ? <Dashboard /> : <Login />
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
