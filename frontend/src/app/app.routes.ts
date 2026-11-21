import { Routes } from '@angular/router';
import { authGuard } from './services/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/login/login').then(m => m.LoginComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./components/layout/layout').then(m => m.LayoutComponent),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./components/dashboard/dashboard').then(m => m.DashboardComponent)
      },
      {
        path: 'raw-products',
        loadComponent: () => import('./components/raw-products/raw-products').then(m => m.RawProductsComponent)
      },
      {
        path: 'finished-products',
        loadComponent: () => import('./components/finished-products/finished-products').then(m => m.FinishedProductsComponent)
      },
      {
        path: 'batches',
        loadComponent: () => import('./components/batches/batches').then(m => m.BatchesComponent)
      },
      {
        path: 'vendors',
        loadComponent: () => import('./components/vendors/vendors').then(m => m.VendorsComponent)
      },
      {
        path: 'purchase-orders',
        loadComponent: () => import('./components/purchase-orders/purchase-orders').then(m => m.PurchaseOrdersComponent)
      },
      {
        path: 'vendor-ledger',
        loadComponent: () => import('./components/vendor-ledger/vendor-ledger').then(m => m.VendorLedgerComponent)
      },
      {
        path: 'reports',
        loadComponent: () => import('./components/reports/reports').then(m => m.ReportsComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
