const express = require('express');
const db = require('./db');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Untuk membaca data dari form
app.use(express.static('public')); // Untuk file CSS/JS
app.set('view engine', 'ejs');

// Rute Utama: Menampilkan semua pesanan
app.get('/', async (req, res) => {
    try {
        const [orders] = await db.execute('SELECT * FROM orders ORDER BY created_at DESC');
        
        // Menghitung total pendapatan dari pesanan yang statusnya 'selesai'
        const [totalRows] = await db.execute(
            'SELECT SUM(jumlah * harga_satuan) as total FROM orders WHERE status = "selesai"'
        );
        const totalPendapatan = totalRows[0].total || 0;

        res.render('index', { orders, totalPendapatan });
    } catch (err) {
        res.status(500).send("Gagal memuat data");
    }
});

// Tambahkan harga_satuan ke dalam query INSERT
app.post('/orders', async (req, res) => {
    const { nama_pelanggan, jenis_canang, jumlah, harga_satuan } = req.body;
    
    try {
        const [result] = await db.execute(
            'INSERT INTO orders (nama_pelanggan, jenis_canang, jumlah, harga_satuan) VALUES (?, ?, ?, ?)',
            [nama_pelanggan, jenis_canang, jumlah, harga_satuan]
        );

        const [newOrder] = await db.execute('SELECT * FROM orders WHERE id = ?', [result.insertId]);
        
        // Kirim sinyal 'updateTotal' agar angka total pendapatan di layar ikut berubah
        res.setHeader('HX-Trigger', 'updateTotal'); 
        res.render('partials/order-item', { order: newOrder[0] });
    } catch (err) {
        res.status(500).send("Gagal menambah pesanan");
    }
});

// Rute untuk update status menjadi selesai
app.put('/orders/done/:id', async (req, res) => {
    const id = req.params.id;
    try {
        await db.execute('UPDATE orders SET status = "selesai" WHERE id = ?', [id]);
        const [rows] = await db.execute('SELECT * FROM orders WHERE id = ?', [id]);

        // Kirim sinyal 'updateTotal' ke frontend
        res.setHeader('HX-Trigger', 'updateTotal');
        res.render('partials/order-item', { order: rows[0] });
    } catch (err) {
        res.status(500).send("Gagal update");
    }
});

// Rute khusus untuk mengambil angka total (hanya angka/teks saja)
app.get('/total-pendapatan', async (req, res) => {
    const [rows] = await db.execute(
        'SELECT SUM(jumlah * harga_satuan) as total FROM orders WHERE status = "selesai"'
    );
    const total = rows[0].total || 0;
    res.send(`Rp ${Number(total).toLocaleString('id-ID')}`);
});

// Rute untuk mengambil form edit (Partial)
app.get('/orders/edit/:id', async (req, res) => {
    const [rows] = await db.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    res.render('partials/order-edit-form', { order: rows[0] });
});

// Rute untuk memproses update data
app.put('/orders/update/:id', async (req, res) => {
    const { nama_pelanggan, jenis_canang, jumlah, harga_satuan } = req.body;
    const id = req.params.id;

    try {
        await db.execute(
            'UPDATE orders SET nama_pelanggan = ?, jenis_canang = ?, jumlah = ?, harga_satuan = ? WHERE id = ?',
            [nama_pelanggan, jenis_canang, jumlah, harga_satuan, id]
        );
        
        const [rows] = await db.execute('SELECT * FROM orders WHERE id = ?', [id]);
        
        // Kirim trigger untuk update total harga kalau-kalau angkanya berubah
        res.setHeader('HX-Trigger', 'updateTotal');
        res.render('partials/order-item', { order: rows[0] });
    } catch (err) {
        res.status(500).send("Gagal update data");
    }
});

// Rute untuk membatalkan edit data
app.get('/orders/cancel-edit/:id', async (req, res) => {
    const [rows] = await db.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    res.render('partials/order-item', { order: rows[0] });
});

// Rute Cetak dan Reset
app.get('/print-reset', async (req, res) => {
    try {
        const [ordersSelesai] = await db.execute('SELECT * FROM orders WHERE status = "selesai"');
        if (ordersSelesai.length === 0) return res.redirect('/');

        const totalFinal = ordersSelesai.reduce((acc, curr) => acc + (curr.jumlah * curr.harga_satuan), 0);

        // Simpan ke arsip
        await db.execute(
            'INSERT INTO archives (total_pendapatan, detail_pesanan) VALUES (?, ?)',
            [totalFinal, JSON.stringify(ordersSelesai)]
        );

        // Hapus yang lama
        await db.execute('DELETE FROM orders WHERE status = "selesai"');

        // LANGSUNG KIRIM DATA (karena ordersSelesai sudah berbentuk Array Object)
        res.render('print-layout', { 
            orders: ordersSelesai, 
            total: totalFinal,
            tanggal: new Date().toLocaleString('id-ID')
        });
    } catch (err) {
        res.status(500).send("Gagal reset");
    }
});

// Rute Halaman Riwayat Arsip
app.get('/history', async (req, res) => {
    const [rows] = await db.execute('SELECT * FROM archives ORDER BY tanggal_arsip DESC');
    res.render('history', { archives: rows });
});

// Rute Tombol Cetak Ulang di Arsip
app.get('/history/print/:id', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM archives WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.send("Data tidak ditemukan");

        const arsip = rows[0];
        
        // PASTIKAN DETAIL DI-PARSE JIKA MASIH BERBENTUK STRING
        let detailPesanan = arsip.detail_pesanan;
        if (typeof detailPesanan === 'string') {
            detailPesanan = JSON.parse(detailPesanan);
        }

        res.render('print-layout', { 
            orders: detailPesanan, // Sekarang ini pasti berbentuk Array
            total: arsip.total_pendapatan,
            tanggal: new Date(arsip.tanggal_arsip).toLocaleString('id-ID')
        });
    } catch (err) {
        res.status(500).send("Gagal cetak ulang");
    }
});

//Rute Menghapus Riwayat Tutup Buku
app.delete('/history/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await db.execute('DELETE FROM archives WHERE id = ?', [id]);
        
        // Kirim response kosong agar HTMX menghapus baris di tabel
        res.send(""); 
    } catch (err) {
        console.error(err);
        res.status(500).send("Gagal menghapus riwayat");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server jalan di http://localhost:${PORT}`);
});