import { Routes, Route } from "react-router-dom";
import WeaponList from "./WeaponList.jsx";
import WeaponDetail from "./WeaponDetail.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<WeaponList />} />
      <Route path="/weapon/:hash/:slug" element={<WeaponDetail />} />
    </Routes>
  );
}
