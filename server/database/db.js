const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Importar configurações do banco de dados
const dbConfig = require('../config/database');

// Conexão com o banco de dados
let pool = null;

// Inicializar banco de dados
async function initDatabase() {
    try {
        // Criar conexão com o pool do MySQL
        pool = mysql.createPool(dbConfig);
        
        console.log(`Banco de dados MySQL conectado em: ${dbConfig.host}/${dbConfig.database}`);
        
        // Criar as tabelas necessárias
        await criarTabelas();
        
        return true;
    } catch (error) {
        console.error('Erro ao inicializar o banco de dados:', error);
        return false;
    }
}

// Criar tabelas necessárias
async function criarTabelas() {
    try {
        // Tabela de clientes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS clientes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                telefone VARCHAR(20) NOT NULL,
                profissao VARCHAR(100),
                renda DECIMAL(10,2),
                data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('Tabela clientes verificada/criada com sucesso');
        
        // Tabela de simulações
        await pool.query(`
            CREATE TABLE IF NOT EXISTS simulacoes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                cliente_id INT NOT NULL,
                valor_imovel DECIMAL(12,2) NOT NULL,
                valor_entrada DECIMAL(12,2) NOT NULL,
                valor_financiado DECIMAL(12,2) NOT NULL,
                prazo INT NOT NULL,
                valor_parcela_financiamento DECIMAL(10,2) NOT NULL,
                valor_parcela_consorcio DECIMAL(10,2) NOT NULL,
                total_financiamento DECIMAL(12,2) NOT NULL,
                total_consorcio DECIMAL(12,2) NOT NULL,
                economia_total DECIMAL(12,2) NOT NULL,
                caminho_arquivo_pdf VARCHAR(255),
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
            )
        `);
        
        console.log('Tabela simulacoes verificada/criada com sucesso');
        
        return true;
    } catch (error) {
        console.error('Erro ao criar tabelas:', error);
        return false;
    }
}

// Salvar uma nova simulação
async function salvarSimulacao(dados) {
    let connection;
    try {
        // Obter conexão do pool
        connection = await pool.getConnection();
        
        // Início da transação
        await connection.beginTransaction();
        
        // Verifica se o cliente já existe (pelo email)
        const [clientes] = await connection.query(
            'SELECT id FROM clientes WHERE email = ?',
            [dados.cliente.email]
        );
        
        let clienteId;
        
        if (clientes.length > 0) {
            // Atualiza o cliente existente
            clienteId = clientes[0].id;
            await connection.query(
                `UPDATE clientes 
                SET nome = ?, telefone = ?, profissao = ?, renda = ? 
                WHERE id = ?`,
                [
                    dados.cliente.nome,
                    dados.cliente.telefone,
                    dados.cliente.profissao || null,
                    dados.cliente.renda || null,
                    clienteId
                ]
            );
            console.log(`Cliente atualizado com ID: ${clienteId}`);
        } else {
            // Insere um novo cliente
            const [result] = await connection.query(
                `INSERT INTO clientes (nome, email, telefone, profissao, renda) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    dados.cliente.nome,
                    dados.cliente.email,
                    dados.cliente.telefone,
                    dados.cliente.profissao || null,
                    dados.cliente.renda || null
                ]
            );
            clienteId = result.insertId;
            console.log(`Novo cliente inserido com ID: ${clienteId}`);
        }
        
        // Insere a simulação
        const valorImovel = dados.valorCredito || dados.valorImovel;
        const valorEntrada = dados.entrada || dados.valorEntrada;
        const valorFinanciado = dados.valorFinanciado;
        const prazo = dados.prazo || dados.financiamento.parcelas;
        
        const [simulacaoResult] = await connection.query(
            `INSERT INTO simulacoes (
                cliente_id, valor_imovel, valor_entrada, valor_financiado, 
                prazo, valor_parcela_financiamento, valor_parcela_consorcio,
                total_financiamento, total_consorcio, economia_total, caminho_arquivo_pdf
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clienteId,
                valorImovel,
                valorEntrada,
                valorFinanciado,
                prazo,
                dados.financiamento.valorParcela,
                dados.consorcio.valorParcela,
                dados.financiamento.totalPago,
                dados.consorcio.totalPago,
                dados.financiamento.totalPago - dados.consorcio.totalPago,
                dados.caminhoArquivoPDF
            ]
        );
        
        // Commit da transação
        await connection.commit();
        
        console.log(`Nova simulação inserida com ID: ${simulacaoResult.insertId}`);
        
        return {
            success: true,
            simulacaoId: simulacaoResult.insertId,
            clienteId
        };
    } catch (error) {
        // Rollback em caso de erro
        if (connection) await connection.rollback();
        
        console.error('Erro ao salvar simulação:', error);
        
        return {
            success: false,
            error: error.message
        };
    } finally {
        // Liberar a conexão de volta para o pool
        if (connection) connection.release();
    }
}

// Obter uma simulação por ID
async function obterSimulacaoPorId(id) {
    try {
        const [rows] = await pool.query(
            `SELECT 
                s.id, s.valor_imovel, s.valor_entrada, s.valor_financiado, s.prazo,
                s.valor_parcela_financiamento, s.valor_parcela_consorcio,
                s.total_financiamento, s.total_consorcio, s.economia_total,
                s.caminho_arquivo_pdf, 
                DATE_FORMAT(s.data_criacao, '%Y-%m-%dT%H:%i:%s.000Z') as dataCriacao,
                c.id as cliente_id, c.nome, c.email, c.telefone, c.profissao, c.renda
            FROM simulacoes s
            INNER JOIN clientes c ON s.cliente_id = c.id
            WHERE s.id = ?`,
            [id]
        );
        
        if (rows.length === 0) {
            return {
                success: false,
                error: 'Simulação não encontrada'
            };
        }
        
        // Obter dados brutos
        const dadosBrutos = rows[0];
        
        // Verificar e corrigir valores caso estejam ausentes ou zerados
        // Se o valor do imóvel for zero, tentaremos recuperar um valor padrão (por exemplo, 500000)
        const valorImovel = parseFloat(dadosBrutos.valor_imovel) || 500000;
        const valorEntrada = parseFloat(dadosBrutos.valor_entrada) || (valorImovel * 0.2); // 20% de entrada padrão
        const valorFinanciado = parseFloat(dadosBrutos.valor_financiado) || (valorImovel - valorEntrada);
        
        // Taxa administrativa do consórcio (28%)
        const taxaAdm = 28;
        // Valor da carta de crédito é igual ao valor do imóvel
        const valorCarta = valorImovel;
        // Prazo do consórcio padronizado em 240 meses
        const prazoConsorcio = 240;
        
        // Verificar o valor da parcela do consórcio e corrigir se necessário
        let valorParcelaConsorcio = parseFloat(dadosBrutos.valor_parcela_consorcio);
        if (!valorParcelaConsorcio || valorParcelaConsorcio <= 0) {
            // Cálculo simplificado da parcela do consórcio
            valorParcelaConsorcio = (valorImovel * (1 + taxaAdm/100)) / prazoConsorcio;
        }
        
        // Calcular parcela reduzida (metade da parcela do consórcio após lance)
        const parcelaReduzida = parseFloat(dadosBrutos.valor_parcela_consorcio) / 2 || valorParcelaConsorcio / 2;
        
        // Parcela de financiamento
        let valorParcelaFinanciamento = parseFloat(dadosBrutos.valor_parcela_financiamento);
        if (!valorParcelaFinanciamento || valorParcelaFinanciamento <= 0) {
            // Taxa mensal aproximada de 0.9% (11.49% a.a.)
            const taxaMensal = 0.009;
            const prazoFinanciamento = dadosBrutos.prazo || 420;
            // Fórmula de financiamento: PMT = PV * r * (1+r)^n / ((1+r)^n - 1)
            const numerador = valorFinanciado * taxaMensal * Math.pow(1 + taxaMensal, prazoFinanciamento);
            const denominador = Math.pow(1 + taxaMensal, prazoFinanciamento) - 1;
            valorParcelaFinanciamento = numerador / denominador;
        }
        
        // Prazo do financiamento (geralmente 420 meses = 35 anos)
        const prazoFinanciamento = dadosBrutos.prazo || 420;
        
        // Recalcular totais se necessário (INCLUINDO A ENTRADA no total do financiamento)
        let totalFinanciamento = parseFloat(dadosBrutos.total_financiamento);
        if (!totalFinanciamento || totalFinanciamento <= 0) {
            // Total = (Parcela mensal * número de parcelas) + valor da entrada
            totalFinanciamento = (valorParcelaFinanciamento * prazoFinanciamento) + valorEntrada;
        }
        
        // Sempre recalcular o total do financiamento para garantir que inclua a entrada
        // Esta linha substitui o cálculo condicional acima
        totalFinanciamento = (valorParcelaFinanciamento * prazoFinanciamento) + valorEntrada;
        
        let totalConsorcio = parseFloat(dadosBrutos.total_consorcio);
        if (!totalConsorcio || totalConsorcio <= 0) {
            totalConsorcio = valorParcelaConsorcio * prazoConsorcio;
        }
        
        // Calcular economia
        const economiaTotal = totalFinanciamento - totalConsorcio;
        // Calcular porcentagem de economia
        const porcentagemEconomia = (economiaTotal / totalFinanciamento) * 100;

        // Garantir que a renda do cliente seja um valor válido
        const rendaCliente = parseFloat(dadosBrutos.renda) || 8000; // Valor padrão caso não exista
        
        // Transformar para o formato esperado pelo frontend
        const simulacao = {
            id: dadosBrutos.id,
            valorImovel: valorImovel,
            valorEntrada: valorEntrada,
            valorFinanciado: valorFinanciado,
            prazo: prazoFinanciamento,
            valorParcelaFinanciamento: valorParcelaFinanciamento,
            valorParcelaConsorcio: valorParcelaConsorcio,
            totalFinanciamento: totalFinanciamento,
            totalConsorcio: totalConsorcio,
            economiaTotal: economiaTotal,
            porcentagemEconomia: porcentagemEconomia,
            caminhoArquivoPDF: dadosBrutos.caminho_arquivo_pdf,
            dataCriacao: dadosBrutos.dataCriacao,
            // Dados do financiamento
            financiamento: {
                credito: valorImovel,
                entrada: valorEntrada,
                valorFinanciado: valorFinanciado,
                taxaAnual: 11.49, // Valor padrão
                prazo: prazoFinanciamento,
                valorParcela: valorParcelaFinanciamento,
                total: totalFinanciamento
            },
            // Dados do consórcio
            consorcio: {
                valorCarta: valorCarta,
                taxaAdm: taxaAdm,
                parcelas: prazoConsorcio,
                valorParcela: valorParcelaConsorcio,
                parcelaReduzida: parcelaReduzida,
                // Valor do lance (estimado em 25% do valor da carta)
                lance: valorCarta * 0.25,
                totalPago: totalConsorcio
            },
            // Dados do cliente
            cliente: {
                id: dadosBrutos.cliente_id,
                nome: dadosBrutos.nome,
                email: dadosBrutos.email,
                telefone: dadosBrutos.telefone,
                profissao: dadosBrutos.profissao,
                renda: rendaCliente
            }
        };
        
        console.log('Dados da simulação processados:', JSON.stringify(simulacao, null, 2));
        
        return {
            success: true,
            simulacao: simulacao
        };
    } catch (error) {
        console.error('Erro ao obter simulação:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Listar simulações
async function listarSimulacoes(pagina = 1, limite = 10, campo = 'nome', filtro = '') {
    try {
        const offset = (pagina - 1) * limite;
        
        // Contar total de registros com filtro aplicado
        let countQuery = `
            SELECT COUNT(*) as total 
            FROM simulacoes s
            INNER JOIN clientes c ON s.cliente_id = c.id
        `;
        
        let whereClause = '';
        let params = [];
        
        if (filtro) {
            whereClause = ' WHERE c.nome LIKE ? OR c.email LIKE ? OR c.telefone LIKE ?';
            params = [`%${filtro}%`, `%${filtro}%`, `%${filtro}%`];
        }
        
        countQuery += whereClause;
        
        // Executar consulta de contagem
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;
        
        // Consulta para buscar as simulações, usar DATE_FORMAT para formatar a data
        let query = `
            SELECT 
                s.id, s.valor_imovel, s.valor_entrada, s.prazo, 
                s.valor_parcela_financiamento, s.valor_parcela_consorcio,
                s.total_financiamento, s.total_consorcio, s.economia_total,
                s.caminho_arquivo_pdf, 
                DATE_FORMAT(s.data_criacao, '%Y-%m-%dT%H:%i:%s.000Z') as dataCriacao, 
                c.id as cliente_id, c.nome, c.email, c.telefone, c.renda
            FROM simulacoes s
            INNER JOIN clientes c ON s.cliente_id = c.id
            ${whereClause}
        `;
        
        // Ordenação
        if (campo === 'valor') {
            query += ' ORDER BY s.valor_imovel DESC';
        } else if (campo === 'data') {
            query += ' ORDER BY s.data_criacao DESC';
        } else {
            query += ' ORDER BY c.nome ASC';
        }
        
        // Paginação
        query += ' LIMIT ? OFFSET ?';
        params.push(limite, offset);
        
        // Executar consulta principal
        const [rows] = await pool.query(query, params);
        
        // Transformar os dados para o formato esperado pelo frontend
        const simulacoes = rows.map(row => {
            return {
                id: row.id,
                valorImovel: row.valor_imovel,
                valorEntrada: row.valor_entrada,
                prazo: row.prazo,
                valorParcelaFinanciamento: row.valor_parcela_financiamento,
                valorParcelaConsorcio: row.valor_parcela_consorcio,
                totalFinanciamento: row.total_financiamento,
                totalConsorcio: row.total_consorcio,
                economiaTotal: row.economia_total,
                caminhoArquivoPDF: row.caminho_arquivo_pdf,
                dataCriacao: row.dataCriacao,
                cliente: {
                    id: row.cliente_id,
                    nome: row.nome,
                    email: row.email,
                    telefone: row.telefone,
                    renda: row.renda
                }
            };
        });
        
        return {
            success: true,
            simulacoes: simulacoes,
            total: total,
            pagination: {
                total,
                pagina,
                limite,
                totalPaginas: Math.ceil(total / limite)
            }
        };
    } catch (error) {
        console.error('Erro ao listar simulações:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Excluir simulação
async function excluirSimulacao(id) {
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // Verificar se a simulação existe
        const [simulacoes] = await connection.query(
            'SELECT caminho_arquivo_pdf, cliente_id FROM simulacoes WHERE id = ?',
            [id]
        );
        
        if (simulacoes.length === 0) {
            return {
                success: false,
                error: 'Simulação não encontrada'
            };
        }
        
        const simulacao = simulacoes[0];
        
        // Deletar o arquivo PDF se existir
        if (simulacao.caminho_arquivo_pdf) {
            const caminhoCompleto = path.join(__dirname, '../../', simulacao.caminho_arquivo_pdf);
            
            if (fs.existsSync(caminhoCompleto)) {
                fs.unlinkSync(caminhoCompleto);
                console.log(`Arquivo removido: ${caminhoCompleto}`);
            }
        }
        
        // Excluir a simulação
        await connection.query('DELETE FROM simulacoes WHERE id = ?', [id]);
        
        // Verificar se existem outras simulações para o mesmo cliente
        const [outrasSimulacoes] = await connection.query(
            'SELECT COUNT(*) as total FROM simulacoes WHERE cliente_id = ?',
            [simulacao.cliente_id]
        );
        
        // Se não existem mais simulações, excluir o cliente também
        if (outrasSimulacoes[0].total === 0) {
            await connection.query('DELETE FROM clientes WHERE id = ?', [simulacao.cliente_id]);
            console.log(`Cliente ${simulacao.cliente_id} excluído (não possuía mais simulações)`);
        }
        
        await connection.commit();
        
        return {
            success: true,
            message: 'Simulação excluída com sucesso'
        };
    } catch (error) {
        if (connection) await connection.rollback();
        
        console.error('Erro ao excluir simulação:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        if (connection) connection.release();
    }
}

// Listar clientes
async function listarClientes(pagina = 1, limite = 10, filtro = '') {
    try {
        const offset = (pagina - 1) * limite;
        
        // Contar total de registros
        let countQuery = 'SELECT COUNT(*) as total FROM clientes';
        let params = [];
        
        if (filtro) {
            countQuery += ' WHERE nome LIKE ? OR email LIKE ? OR telefone LIKE ?';
            params = [`%${filtro}%`, `%${filtro}%`, `%${filtro}%`];
        }
        
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;
        
        // Consulta principal
        let query = `
            SELECT id, nome, email, telefone, profissao, renda, data_cadastro
            FROM clientes
        `;
        
        if (filtro) {
            query += ' WHERE nome LIKE ? OR email LIKE ? OR telefone LIKE ?';
        }
        
        query += ' ORDER BY nome ASC LIMIT ? OFFSET ?';
        params.push(limite, offset);
        
        const [rows] = await pool.query(query, params);
        
        return {
            success: true,
            clientes: rows,
            pagination: {
                total,
                pagina,
                limite,
                totalPaginas: Math.ceil(total / limite)
            }
        };
    } catch (error) {
        console.error('Erro ao listar clientes:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Verificar status do banco de dados
async function verificarStatusBanco() {
    try {
        const [result] = await pool.query('SELECT 1 as connected');
        
        return {
            success: true,
            connected: result[0].connected === 1,
            tipo: 'MySQL',
            versao: await obterVersaoMySQL()
        };
    } catch (error) {
        console.error('Erro ao verificar status do banco:', error);
        return {
            success: false,
            connected: false,
            error: error.message
        };
    }
}

// Obter versão do MySQL
async function obterVersaoMySQL() {
    try {
        const [rows] = await pool.query('SELECT VERSION() as version');
        return rows[0].version;
    } catch (error) {
        console.error('Erro ao obter versão do MySQL:', error);
        return 'Desconhecida';
    }
}

// Função para obter acesso ao pool de conexões
function getPool() {
    return pool;
}

// Exportar funções do módulo
module.exports = {
    salvarSimulacao,
    obterSimulacaoPorId,
    listarSimulacoes,
    excluirSimulacao,
    listarClientes,
    verificarStatusBanco,
    initDatabase,
    getPool
}; 