import { Routes } from '@angular/router';
import { authGuard } from './services/auth.guard';
import { permissionGuard } from './services/permission.guard';

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
        canActivate: [permissionGuard],
        data: { module: 'dashboard' },
        loadComponent: () => import('./components/dashboard/dashboard').then(m => m.DashboardComponent)
      },
      {
        path: 'raw-products',
        canActivate: [permissionGuard],
        data: { module: 'raw-products' },
        loadComponent: () => import('./components/raw-products/raw-products').then(m => m.RawProductsComponent)
      },
      {
        path: 'finished-products',
        canActivate: [permissionGuard],
        data: { module: 'finished-products' },
        loadComponent: () => import('./components/finished-products/finished-products').then(m => m.FinishedProductsComponent)
      },
      {
        path: 'batches',
        canActivate: [permissionGuard],
        data: { module: 'batches' },
        loadComponent: () => import('./components/batches/batches').then(m => m.BatchesComponent)
      },
      {
        path: 'vendors',
        canActivate: [permissionGuard],
        data: { module: 'vendors' },
        loadComponent: () => import('./components/vendors/vendors').then(m => m.VendorsComponent)
      },
      {
        path: 'purchase-orders',
        canActivate: [permissionGuard],
        data: { module: 'purchase-orders' },
        loadComponent: () => import('./components/purchase-orders/purchase-orders').then(m => m.PurchaseOrdersComponent)
      },
      {
        path: 'vendor-ledger',
        canActivate: [permissionGuard],
        data: { module: 'vendor-ledger' },
        loadComponent: () => import('./components/vendor-ledger/vendor-ledger').then(m => m.VendorLedgerComponent)
      },
      {
        path: 'reports',
        canActivate: [permissionGuard],
        data: { module: 'reports' },
        loadComponent: () => import('./components/reports/reports').then(m => m.ReportsComponent)
      },
      {
        path: 'users',
        canActivate: [permissionGuard],
        data: { module: 'users' },
        loadComponent: () => import('./components/users/users').then(m => m.UsersComponent)
      },
      {
        // Every signed-in user lands here to change their own password, so no guard.
        path: 'account',
        loadComponent: () => import('./components/account/account').then(m => m.AccountComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
