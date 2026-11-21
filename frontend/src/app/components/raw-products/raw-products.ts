import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-raw-products',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './raw-products.html',
  styleUrl: './raw-products.css'
})
export class RawProductsComponent implements OnInit {
  private readonly apiService = inject(ApiService);

  products = signal<any[]>([]);
  isLoading = signal<boolean>(true);
  activeTab = signal<string>('list'); // 'list' or 'add'
  searchTerm = '';

  // Forms data
  newProduct = {
    name: '',
    category: 'Packaging',
    unitType: 'Piece',
    openingStock: 0,
    minimumStockLevel: 0
  };

  selectedProduct = signal<any | null>(null);
  activeModal = signal<string | null>(null); // 'edit' or 'stock-in' or 'stock-out'
  modalError = signal<string | null>(null);
  modalSuccess = signal<string | null>(null);

  // Transaction forms
  stockInData = {
    quantityAdded: 0,
    purchaseReference: '',
    remarks: ''
  };

  stockOutData = {
    quantityDeducted: 0,
    reason: 'Damage',
    remarks: ''
  };

  editData = {
    name: '',
    category: '',
    unitType: 'Piece',
    minimumStockLevel: 0
  };

  ngOnInit(): void {
    this.loadProducts();
  }

  loadProducts(): void {
    this.isLoading.set(true);
    this.apiService.getRawProducts().subscribe({
      next: (res) => {
        this.products.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Fetch products error:', err);
        this.isLoading.set(false);
      }
    });
  }

  get filteredProducts(): any[] {
    if (!this.searchTerm.trim()) {
      return this.products();
    }
    const term = this.searchTerm.toLowerCase();
    return this.products().filter(p => 
      p.name.toLowerCase().includes(term) || 
      (p.category && p.category.toLowerCase().includes(term))
    );
  }

  // Add Raw Product
  onSubmitAdd(): void {
    if (!this.newProduct.name.trim()) return;

    this.apiService.createRawProduct(this.newProduct).subscribe({
      next: () => {
        // Reset form
        this.newProduct = {
          name: '',
          category: 'Packaging',
          unitType: 'Piece',
          openingStock: 0,
          minimumStockLevel: 0
        };
        // Switch tab
        this.activeTab.set('list');
        this.loadProducts();
      },
      error: (err) => {
        alert(err.error?.error || 'Failed to create product.');
      }
    });
  }

  // Open modals
  openModal(product: any, type: string): void {
    this.selectedProduct.set(product);
    this.activeModal.set(type);
    this.modalError.set(null);
    this.modalSuccess.set(null);

    if (type === 'edit') {
      this.editData = {
        name: product.name,
        category: product.category || '',
        unitType: product.unitType,
        minimumStockLevel: product.minimumStockLevel
      };
    } else if (type === 'stock-in') {
      this.stockInData = {
        quantityAdded: 0,
        purchaseReference: '',
        remarks: ''
      };
    } else if (type === 'stock-out') {
      this.stockOutData = {
        quantityDeducted: 0,
        reason: 'Damage',
        remarks: ''
      };
    }
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.selectedProduct.set(null);
    this.modalError.set(null);
    this.modalSuccess.set(null);
  }

  // Submit Edit Metadata
  onSubmitEdit(): void {
    const prod = this.selectedProduct();
    if (!prod) return;

    this.apiService.updateRawProduct(prod.id, this.editData).subscribe({
      next: () => {
        this.modalSuccess.set('Product details updated successfully.');
        setTimeout(() => {
          this.closeModal();
          this.loadProducts();
        }, 1500);
      },
      error: (err) => {
        this.modalError.set(err.error?.error || 'Failed to update product details.');
      }
    });
  }

  // Submit Stock In
  onSubmitStockIn(): void {
    const prod = this.selectedProduct();
    if (!prod) return;

    if (this.stockInData.quantityAdded <= 0) {
      this.modalError.set('Quantity must be greater than zero.');
      return;
    }

    this.apiService.stockIn(prod.id, this.stockInData).subscribe({
      next: () => {
        this.modalSuccess.set('Stock added successfully.');
        setTimeout(() => {
          this.closeModal();
          this.loadProducts();
        }, 1500);
      },
      error: (err) => {
        this.modalError.set(err.error?.error || 'Failed to add stock.');
      }
    });
  }

  // Submit Stock Out
  onSubmitStockOut(): void {
    const prod = this.selectedProduct();
    if (!prod) return;

    if (this.stockOutData.quantityDeducted <= 0) {
      this.modalError.set('Quantity must be greater than zero.');
      return;
    }

    this.apiService.stockOut(prod.id, this.stockOutData).subscribe({
      next: () => {
        this.modalSuccess.set('Stock deducted successfully.');
        setTimeout(() => {
          this.closeModal();
          this.loadProducts();
        }, 1500);
      },
      error: (err) => {
        this.modalError.set(err.error?.error || 'Failed to deduct stock.');
      }
    });
  }
}
