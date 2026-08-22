/**
 * Route table + page chrome.
 *
 * The paths are the same ones the old hash router used, so existing bookmarks
 * (#/orders/12, #/print/order/12) keep working.
 */
import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell.jsx';
import { Card, Loading, PageHead } from './components/ui.jsx';
import { useMeta } from './api/meta.jsx';

import Dashboard from './pages/Dashboard.jsx';
import EmployeeList from './pages/EmployeeList.jsx';

import CustomerList from './pages/customers/CustomerList.jsx';
import CustomerForm from './pages/customers/CustomerForm.jsx';
import CustomerDetail from './pages/customers/CustomerDetail.jsx';

import PrescriptionList from './pages/prescriptions/PrescriptionList.jsx';
import PrescriptionForm from './pages/prescriptions/PrescriptionForm.jsx';

import BookingCalendar from './pages/bookings/BookingCalendar.jsx';
import BookingForm from './pages/bookings/BookingForm.jsx';
import BookingDetail from './pages/bookings/BookingDetail.jsx';
import Settings from './pages/bookings/Settings.jsx';

import CaseBoard from './pages/cases/CaseBoard.jsx';
import CaseForm from './pages/cases/CaseForm.jsx';
import CaseDetail from './pages/cases/CaseDetail.jsx';
import LensTracker from './pages/cases/LensTracker.jsx';

import OrderList from './pages/orders/OrderList.jsx';
import OrderForm from './pages/orders/OrderForm.jsx';
import OrderDetail from './pages/orders/OrderDetail.jsx';
import FillOrder from './pages/orders/FillOrder.jsx';
import CloseOrder from './pages/orders/CloseOrder.jsx';

import StockList from './pages/shop/StockList.jsx';
import StockForm from './pages/shop/StockForm.jsx';
import LocationList from './pages/shop/LocationList.jsx';
import SaleList from './pages/shop/SaleList.jsx';
import SaleForm from './pages/shop/SaleForm.jsx';
import SupplierList from './pages/shop/SupplierList.jsx';

import { IncomeView, ExpenseView } from './pages/finance/Ledger.jsx';

import ReportIndex from './pages/reports/ReportIndex.jsx';
import DailyClosed from './pages/reports/DailyClosed.jsx';
import Monthly from './pages/reports/Monthly.jsx';
import Checklist from './pages/reports/Checklist.jsx';
import Labels from './pages/reports/Labels.jsx';
import Unsold from './pages/reports/Unsold.jsx';
import PrintOrder from './pages/reports/PrintOrder.jsx';
import PrintPrescription from './pages/reports/PrintPrescription.jsx';

/** path -> breadcrumb, matched longest-first */
const TITLES = [
  ['/', 'เมนูหลัก'],
  ['/customers/new', 'ลูกค้าใหม่'],
  ['/customers', 'ลูกค้า'],
  ['/prescriptions/new', 'บันทึกการวัดสายตา'],
  ['/prescriptions', 'วัดสายตา'],
  ['/bookings/new', 'จองคิวใหม่'],
  ['/bookings', 'ปฏิทินจองคิว'],
  ['/settings', 'ตั้งค่า/แจ้งเตือน'],
  ['/cases/new', 'เปิดเคสใหม่'],
  ['/cases', 'กระดานงาน'],
  ['/lens-tracker', 'ติดตามเลนส์'],
  ['/employees', 'พนักงาน'],
  ['/orders/new', 'เปิดออเดอร์ใหม่'],
  ['/orders', 'ออเดอร์ตัดแว่น'],
  ['/sales/new', 'ขายสินค้าทั่วไป'],
  ['/sales', 'ขายสินค้า'],
  ['/stock/new', 'เพิ่มสินค้าเข้าคลัง'],
  ['/stock', 'สต็อกสินค้า'],
  ['/locations', 'ตำแหน่งสินค้า'],
  ['/suppliers', 'ซัพพลายเออร์'],
  ['/income', 'รายรับ'],
  ['/expense', 'รายจ่าย'],
  ['/reports/daily', 'สรุปรายวัน'],
  ['/reports/monthly', 'รายรับรายเดือน'],
  ['/reports/checklist', 'เช็คลิสต์สต็อก'],
  ['/reports/labels', 'พิมพ์ป้ายราคา'],
  ['/reports/unsold', 'สินค้าค้างสต็อก'],
  ['/reports', 'รายงาน'],
  ['/print/order', 'ใบสั่งตัดแว่น'],
  ['/print/prescription', 'ใบวัดสายตา'],
];

function crumbFor(pathname) {
  if (pathname === '/') return 'เมนูหลัก';
  const hit = TITLES
    .filter(([p]) => p !== '/' && (pathname === p || pathname.startsWith(p + '/')))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : 'TimeOptic';
}

function NotFound() {
  return (
    <Card>
      <h2>404 — ไม่พบหน้านี้</h2>
      <p><Link to="/">← กลับเมนูหลัก</Link></p>
    </Card>
  );
}

export default function App() {
  const { ready, error } = useMeta();
  const { pathname } = useLocation();
  const crumb = crumbFor(pathname);

  useEffect(() => {
    document.title = `${crumb} — TimeOptic`;
    window.scrollTo(0, 0);
  }, [crumb, pathname]);

  if (error) {
    return (
      <Shell crumb="เชื่อมต่อไม่ได้">
        <PageHead icon="⚠️" title="เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" subtitle="Cannot reach the API" />
        <Card>
          <p className="muted">{error.message}</p>
          <p>ตรวจสอบว่า PHP API และ MySQL/MariaDB ของ XAMPP รันอยู่</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>ลองใหม่</button>
        </Card>
      </Shell>
    );
  }

  if (!ready) {
    return <Shell crumb="กำลังโหลด"><Loading text="กำลังเชื่อมต่อระบบ…" /></Shell>;
  }

  return (
    <Shell crumb={crumb}>
      <Routes>
        <Route path="/" element={<Dashboard />} />

        <Route path="/customers" element={<CustomerList />} />
        <Route path="/customers/new" element={<CustomerForm />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/customers/:id/edit" element={<CustomerForm />} />

        <Route path="/prescriptions" element={<PrescriptionList />} />
        <Route path="/prescriptions/new" element={<PrescriptionForm />} />
        <Route path="/prescriptions/:id" element={<PrescriptionForm />} />

        <Route path="/bookings" element={<BookingCalendar />} />
        <Route path="/bookings/new" element={<BookingForm />} />
        <Route path="/bookings/:id" element={<BookingDetail />} />
        <Route path="/bookings/:id/edit" element={<BookingForm />} />
        <Route path="/settings" element={<Settings />} />

        <Route path="/cases" element={<CaseBoard />} />
        <Route path="/cases/new" element={<CaseForm />} />
        <Route path="/cases/:id" element={<CaseDetail />} />
        <Route path="/lens-tracker" element={<LensTracker />} />

        <Route path="/employees" element={<EmployeeList />} />

        <Route path="/orders" element={<OrderList />} />
        <Route path="/orders/new" element={<OrderForm />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/orders/:id/edit" element={<OrderForm />} />
        <Route path="/orders/:id/fill" element={<FillOrder />} />
        <Route path="/orders/:id/close" element={<CloseOrder />} />

        <Route path="/sales" element={<SaleList />} />
        <Route path="/sales/new" element={<SaleForm />} />
        <Route path="/stock" element={<StockList />} />
        <Route path="/stock/new" element={<StockForm />} />
        <Route path="/stock/:id" element={<StockForm />} />
        <Route path="/locations" element={<LocationList />} />
        <Route path="/suppliers" element={<SupplierList />} />

        <Route path="/income" element={<IncomeView />} />
        <Route path="/expense" element={<ExpenseView />} />

        <Route path="/reports" element={<ReportIndex />} />
        <Route path="/reports/daily" element={<DailyClosed />} />
        <Route path="/reports/monthly" element={<Monthly />} />
        <Route path="/reports/checklist" element={<Checklist />} />
        <Route path="/reports/labels" element={<Labels />} />
        <Route path="/reports/unsold" element={<Unsold />} />

        <Route path="/print/order/:id" element={<PrintOrder />} />
        <Route path="/print/prescription/:id" element={<PrintPrescription />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Shell>
  );
}
