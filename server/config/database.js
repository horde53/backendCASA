/**
 * Configuração do banco de dados MySQL
 * Este arquivo contém as configurações de conexão com o MySQL.
 * 
 * Configurado para funcionar com variáveis de ambiente do Railway
 * ou localmente para desenvolvimento
 */

// Detecta se é ambiente de produção
const isProd = process.env.NODE_ENV === 'production';

// Configurações de desenvolvimento (local)
const devConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'casa_programada',
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Configurações de produção (Railway)
const prodConfig = {
    host: process.env.MYSQLHOST || 'localhost',
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: parseInt(process.env.MYSQLPORT || '3306'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Exporta a configuração apropriada para o ambiente
module.exports = isProd ? prodConfig : devConfig; 