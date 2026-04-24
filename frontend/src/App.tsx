import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.tsx';
import Project from './pages/Project.tsx';
import NicheFinder from './pages/NicheFinder.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects/:id" element={<Project />} />
        <Route path="/niche-finder" element={<NicheFinder />} />
        <Route path="*" element={<div className="p-8 text-center text-gray-500">404 — Page not found</div>} />
      </Routes>
    </BrowserRouter>
  );
}
