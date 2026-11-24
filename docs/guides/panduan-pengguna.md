# Panduan pengguna

*English: [User guide](user-guide.md).*

> Terjemahan ini perlu disemak oleh penutur asli Bahasa Melayu sebelum
> diedarkan kepada pelanggan.

Panduan ini untuk semua pengguna ERP setiap hari. Apa yang boleh anda lakukan
bergantung pada peranan anda; butang untuk langkah yang bukan milik peranan anda
tidak dipaparkan.

## Log masuk

Buka alamat ERP organisasi anda. Log masuk dengan e-mel dan kata laluan, atau
tekan **Log masuk dengan …** jika organisasi anda menggunakan log masuk tunggal
(SSO).

- Kali pertama, anda memilih kata laluan sendiri (sekurang-kurangnya 12 aksara).
- Selepas 60 minit tanpa aktiviti, anda akan dilog keluar; log masuk semula.
- Lima kata laluan yang salah mengunci akaun anda selama 15 minit. Pentadbir
  boleh membukanya serta-merta.
- **EN / BM** di bahagian atas menukar bahasa.

## Mencari jalan

| Skrin | Kegunaan |
|---|---|
| Papan Pemuka | Gambaran hari ini: kerja terbuka, pelanggaran SLA, AOG/ROA, hasil |
| Daftar Kerja JTS | Setiap kerja komponen, dari penerimaan hingga pemulangan |
| Keutamaan AOG / ROA | Kerja yang ditanda untuk dipercepat, dan laluannya |
| Vendor Luar | Pembaikan yang dihantar kepada vendor luar |
| Permohonan & Perolehan | Permohonan alat ganti, RFQ, sebut harga dan PO |
| Pembekal & Vendor | Daftar pembekal dan subkontraktor yang diluluskan |
| Invois & Hasil | Invois hingga bayaran, berserta dokumen |
| FOD & Kualiti | Insiden FOD, akauntabiliti alatan, latihan |
| Laporan & Eksport | Laporan Excel/CSV (peranan bil, kualiti dan pengurusan) |

**Loceng** di bahagian atas memaparkan amaran bagi rekod yang menunggu
tindakan anda: rekod yang hampir melanggar SLA, atau yang telah melanggarnya.
Klik amaran untuk membuka rekod tersebut.

## Mengendalikan rekod

Setiap rekod memaparkan peringkatnya, sejarahnya, dan tindakan yang boleh
diambil oleh peranan anda sekarang. Untuk menggerakkannya:

1. Tekan tindakan (contohnya *Hantar ke bengkel*).
2. Isi medan yang diminta — semuanya wajib, selalunya nombor borang seperti F219.
3. Hantar. Langkah itu, nama anda, masa dan maklumat yang dimasukkan ditambah
   ke jejak audit, yang tidak boleh diubah.

Kerja yang ditutup akan dikunci. Kerja yang telah ditutup lebih setahun
dipindahkan ke arkib; tanda **Show archived** pada daftar untuk melihatnya.

## Lampiran

Pada kerja atau invois, **Attach file** menambah borang imbasan, sijil atau
gambar (PDF, imej, Excel, Word, CSV; sehingga 20 MB). Nyatakan nombor borang
jika ada. Fail disimpan secara kekal — jika tersilap melampirkan fail, lampirkan
fail yang betul; kedua-duanya kekal dalam rekod. Setiap muat turun disemak
dengan cap jari yang diambil semasa muat naik.

## Mengikut peranan

**Stor** — daftar barang masuk (*+ Register job*), hantar ke bengkel, rekod
semakan stok, keluarkan dan terima alat ganti, dan cetak **kad kerja**: pada
kerja, *Print job card*; pada daftar, *Print cards* mencetak kad bagi setiap
kerja yang tersenarai. Mengimbas kod QR pada kad akan membuka kerja tersebut.

**Bengkel** — rekod pemeriksaan rombak (TDI), mohon alat ganti, dan salurkan
kerja: sebut harga, BER, SOR atau vendor luar.

**MIS** — mulakan kerja apabila alat ganti tiba; pemeriksaan akhir dan
pensijilan.

**MM (pengurusan)** — luluskan permohonan, rekod indent pelanggan, isytihar
BER, tutup kerja; anda juga menerima amaran bagi setiap pelanggaran SLA.

**Perolehan** — keluarkan RFQ, rekod sebut harga (sekurang-kurangnya tiga,
atau kelulusan pembelian tempatan), nilai dan keluarkan PO.

**PCE** — uruskan pembaikan vendor luar dan keutamaan AOG/ROA.

**Kualiti** — penilaian pembekal, CAR, insiden FOD dan eksport jejak audit;
bersama pentadbir, anda boleh mengubah aliran kerja dan pemasa SLA dalam
**Workflow editor**.

**Bil dan Kewangan** — buka invois, sahkan, keluarkan invois cukai, lepasi
semakan ketepatan, hantar dan rekod bayaran. Pada invois, **Documents**
memuat turun invois cukai, surat iringan, nota hantaran atau pek penuh (versi
*Salinan Diakui Sah* setelah rujukan CTC direkodkan). Laporan menyediakan
Laporan Prestasi Jualan, fail e-Payment dan bayaran tertunggak.

**Pentadbir** — pengguna, tetapan, log masuk tunggal dan penyunting aliran
kerja; lihat [panduan pentadbir](admin-guide.md) (dalam Bahasa Inggeris).

## Apabila ada masalah

- Sepanduk *Cannot reach the server*: sambungan anda atau pelayan terputus;
  perubahan tidak disimpan sehingga pulih.
- *Stage owned by …*: langkah itu milik peranan lain.
- *Mandatory fields missing*: isi setiap medan yang diminta.
- *Someone else changed this record first*: muat semula halaman dan cuba lagi.
