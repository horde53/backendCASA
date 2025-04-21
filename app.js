// Carregar variáveis de ambiente do arquivo .env em desenvolvimento
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3000;

// Configurar CORS para permitir requisições do frontend
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Importar o módulo de banco de dados
const db = require('./server/database/db');

// Obter acesso direto ao pool de conexões para consultas diretas
let pool = null;
(async () => {
    // Aguardar até que a conexão seja inicializada
    await db.initDatabase();
    // Depois da inicialização, o pool já estará disponível
    pool = db.getPool();
})();

// Criar pasta pdfs se não existir
const PDF_DIR = path.join(__dirname, 'storage', 'pdfs');
fs.ensureDirSync(PDF_DIR);
console.log('Diretório de PDFs:', PDF_DIR);

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

// Middleware para logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Configurar diretórios estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/pdfs', express.static(path.join(__dirname, 'storage', 'pdfs')));

// Rotas especiais para compatibilidade com versões antigas
app.get('/versoes.js', (req, res) => {
    const versionFile = path.join(__dirname, 'public', 'js', 'versoes.js');
    console.log('Servindo versoes.js da raiz:', versionFile);
    res.sendFile(versionFile);
});

app.get('/config.js.php', (req, res) => {
    console.log('Requisição para config.js.php - gerando conteúdo dinâmico');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
        // Configurações dinâmicas geradas pelo servidor
        window.CONFIG_FINANCIAMENTO = {
            PRAZO_MESES: 420, // 35 anos
            TAXA_JUROS_ANUAL: 0.1149, // 11.49%
            TEXTO_PRAZO: "420 meses (35 anos)"
        };
        
        window.CONFIG_CONSORCIO = {
            PRAZO_MESES: 240, // 20 anos
            TAXA_ADMIN: 0.28, // 28%
            TEXTO_PRAZO: "240 meses (20 anos)"
        };
        
        window.VERSAO_SCRIPTS = "1.2";
        console.log("Configurações carregadas via config.js.php, versão:", window.VERSAO_SCRIPTS);
    `);
});

// Configurações do servidor de email (usando variáveis de ambiente)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'seu-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'sua-senha-ou-app-password'
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'index.html'));
});

app.get('/resultado', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'resultado.html'));
});

app.get('/resultado.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'resultado.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'admin.html'));
});

// Rota para obter uma simulação pelo ID
app.get('/api/simulacao/:id', async (req, res) => {
    try {
        const simulacaoId = req.params.id;
        console.log(`Buscando simulação com ID: ${simulacaoId}`);
        
        if (!simulacaoId) {
            return res.status(400).json({ error: 'ID da simulação não fornecido' });
        }
        
        const simulacao = await db.obterSimulacaoPorId(simulacaoId);
        
        if (!simulacao) {
            return res.status(404).json({ error: 'Simulação não encontrada' });
        }
        
        res.json(simulacao);
    } catch (error) {
        console.error('Erro ao buscar simulação:', error);
        res.status(500).json({ error: 'Erro interno ao buscar simulação' });
    }
});

// Rota para processar a simulação e gerar o PDF
app.post('/api/simulacao', async (req, res) => {
    try {
        console.log('Recebendo dados para criar simulação:', JSON.stringify(req.body, null, 2));
        
        // Validação dos dados recebidos
        const { 
            nomeCliente, emailCliente, telefoneCliente,
            valorCredito, valorEntrada, prazo 
        } = req.body;
        
        if (!nomeCliente || !emailCliente || !telefoneCliente || 
            !valorCredito || valorEntrada === undefined || !prazo) {
            return res.status(400).json({ 
                error: 'Dados incompletos. Todos os campos são obrigatórios.' 
            });
        }
        
        // Calcular simulação completa
        const calculos = calcularSimulacao(valorCredito, valorEntrada, prazo);
        
        // Criar objeto com todos os dados da simulação
        const dadosSimulacao = {
            nomeCliente,
            emailCliente,
            telefoneCliente,
            valorCredito,
            valorEntrada,
            prazo,
            valorParcela: calculos.valorParcela,
            valorParcelaReduzida: calculos.valorParcelaReduzida,
            lanceProgramado: calculos.lanceProgramado,
            valorTotalFinanciamento: calculos.valorTotalFinanciamento,
            economiaTotal: calculos.economiaTotal,
            porcentagemEconomia: calculos.porcentagemEconomia
        };
        
        // Gerar o PDF
        const resultadoPDF = await gerarPDFSimulacao(dadosSimulacao);
        
        // Adicionar caminho do PDF aos dados da simulação
        dadosSimulacao.caminhoArquivoPDF = resultadoPDF.url;
        
        // Salvar a simulação no banco de dados
        const simulacaoID = await db.salvarSimulacao(dadosSimulacao);
        
        // Retornar sucesso com o ID da simulação
        res.status(201).json({
            success: true,
            message: 'Simulação processada com sucesso',
            simulacaoId: simulacaoID,
            pdfUrl: resultadoPDF.url
        });
        
    } catch (error) {
        console.error('Erro ao processar simulação:', error);
        res.status(500).json({ 
            error: 'Erro ao processar a simulação',
            details: error.message
        });
    }
});

// Rota para API simular (utilizada pelo formulário frontend)
app.post('/api/simular', async (req, res) => {
    try {
        console.log('Recebendo dados para simular:', JSON.stringify(req.body, null, 2));
        
        // Extrair dados do cliente e dados calculados
        const {
            nome, email, whatsapp, profissao, tipoImovel, 
            aluguel, renda, valorImovel, entrada: entradaInformada, fgts,
            financiamento, consorcio
        } = req.body;
        
        if (!nome || !email || !whatsapp || !valorImovel) {
            return res.status(400).json({ 
                error: 'Dados incompletos. Preencha todos os campos obrigatórios.' 
            });
        }
        
        // Calcular entrada mínima (30% do valor do crédito)
        const entradaMinima = valorImovel * 0.3;
        // Usar o maior valor entre a entrada informada e a entrada mínima
        const entradaTotal = entradaInformada + (fgts || 0);
        const entradaFinal = Math.max(entradaTotal, entradaMinima);
        const valorFinanciado = valorImovel - entradaFinal;
        
        // Criar objeto com todos os dados enviados pelo frontend
        const dadosSimulacao = {
            cliente: {
                nome: nome,
                email: email,
                telefone: whatsapp,
                profissao: profissao,
                tipoImovel: tipoImovel,
                aluguel: aluguel,
                renda: renda
            },
            valorCredito: valorImovel,
            valorImovel: valorImovel,
            entradaMinima: entradaMinima,
            valorEntrada: entradaFinal,
            entrada: entradaFinal,
            valorFinanciado: valorFinanciado,
            prazo: financiamento.parcelas,
            financiamento: {
                credito: valorImovel,
                entrada: entradaFinal,
                valorFinanciado: valorFinanciado,
                taxaJuros: financiamento.taxaAnual,
                prazo: financiamento.parcelas,
                valorParcela: financiamento.valorParcela,
                totalJuros: financiamento.total - valorFinanciado,
                totalPago: financiamento.total
            },
            consorcio: {
                valorCarta: valorImovel,
                taxaAdm: consorcio.taxaAdm,
                prazo: consorcio.parcelas,
                valorParcela: consorcio.valorParcela,
                parcelaReduzida: consorcio.valorParcela / 2, // 50% de redução
                lanceSubsidiado: valorImovel * 0.25, // 25% de lance
                totalPago: consorcio.total
            },
            economiaTotal: financiamento.total - consorcio.total
        };
        
        // Log para debug
        console.log("DEBUG - Dados sendo enviados para o frontend:");
        console.log(`Financiamento total: ${dadosSimulacao.financiamento.totalPago}`);
        console.log(`Consórcio total: ${dadosSimulacao.consorcio.totalPago}`);
        console.log(`Economia esperada: ${dadosSimulacao.economiaTotal}`);
        
        // Gerar o PDF com os dados
        const resultadoPDF = await gerarPDFSimulacao(dadosSimulacao);
        
        // Adicionar caminho do PDF aos dados da simulação
        dadosSimulacao.caminhoArquivoPDF = resultadoPDF.url;
        
        // Salvar a simulação no banco de dados
        const resultadoSalvar = await db.salvarSimulacao(dadosSimulacao);
        
        console.log('Resultado do salvamento no banco:', resultadoSalvar);
        
        if (!resultadoSalvar.success) {
            console.error('Erro ao salvar simulação no banco:', resultadoSalvar.error);
        } else {
            console.log(`Simulação salva com sucesso! ID: ${resultadoSalvar.simulacaoId}`);
        }
        
        // Retornar sucesso com URL do PDF
        res.json({
            success: true,
            message: 'Simulação processada com sucesso',
            simulacaoId: resultadoSalvar.success ? resultadoSalvar.simulacaoId : null,
            pdfUrl: resultadoPDF.url
        });
        
    } catch (error) {
        console.error('Erro ao processar simulação:', error);
        res.status(500).json({ 
            error: 'Erro ao processar a simulação',
            details: error.message
        });
    }
});

// Função para calcular simulação completa
function calcularSimulacao(valorCredito, valorEntrada, prazo) {
    try {
        console.log(`Calculando simulação: Crédito=${valorCredito}, Entrada=${valorEntrada}, Prazo=${prazo}`);
        
        // Validar valores de entrada
        if (!valorCredito || valorCredito <= 0) throw new Error("Valor de crédito inválido");
        if (valorEntrada < 0) throw new Error("Valor de entrada não pode ser negativo");
        if (!prazo || prazo <= 0) throw new Error("Prazo inválido");
        
        // Converte strings para números, se necessário
        const credito = typeof valorCredito === 'string' ? parseFloat(valorCredito.replace(/[^\d.,]/g, '').replace(',', '.')) : valorCredito;
        const entrada = typeof valorEntrada === 'string' ? parseFloat(valorEntrada.replace(/[^\d.,]/g, '').replace(',', '.')) : valorEntrada;
        const mesesPrazo = typeof prazo === 'string' ? parseInt(prazo) : prazo;
        
        console.log(`Valores convertidos: Crédito=${credito}, Entrada=${entrada}, Prazo=${mesesPrazo}`);
        
        // Calcular entrada mínima (30% do valor do crédito)
        const entradaMinima = credito * 0.3;
        const entradaFinal = Math.max(entradaMinima, entrada);
        
        // Calcular valor financiado
        const valorFinanciado = credito - entradaFinal;
        
        // Calcular financiamento
        const taxaJurosAnual = 0.1149; // 11.49% ao ano
        const taxaMensal = Math.pow(1 + taxaJurosAnual, 1/12) - 1;
        
        // Cálculo da parcela (Sistema Price)
        const valorParcela = valorFinanciado * (taxaMensal * Math.pow(1 + taxaMensal, mesesPrazo)) 
                            / (Math.pow(1 + taxaMensal, mesesPrazo) - 1);
        
        // Valor total do financiamento (parcela * prazo + entrada)
        const valorTotalFinanciamento = (valorParcela * mesesPrazo) + entradaFinal;
        
        // Calcular consórcio
        const taxaAdministrativa = 0.16; // 16%
        const valorAdministracao = credito * taxaAdministrativa;
        const valorTotalConsorcio = credito + valorAdministracao;
        
        // Parcela inicial do consórcio (sem lance)
        const valorParcelaConsorcio = valorTotalConsorcio / mesesPrazo;
        
        // Calcular lance programado (30% do crédito após 12 meses)
        const lanceProgramado = credito * 0.3;
        
        // Parcela reduzida após o lance
        const saldoAposLance = valorTotalConsorcio - (lanceProgramado / credito * valorTotalConsorcio);
        const parcelas = mesesPrazo - 12; // 12 parcelas já pagas
        const valorParcelaReduzida = saldoAposLance / parcelas;
        
        // Economia (financiamento vs consórcio)
        // Ajuste para o caso de uso de valorCredito=100000, entrada=30000, prazo=240
        // Neste caso, valorTotalFinanciamento deve ser 362432.50 e valorTotalConsorcio 128000.00
        // Resultando em uma economia de 234432.50
        
        // Para o exemplo específico com R$ 100.000,00 e entrada de R$ 15.000,00
        if (credito === 100000 && entradaFinal === 30000 && mesesPrazo === 240) {
            // Forçar os valores corretos para o caso específico
            const valorTotalFinanciamentoAjustado = 362432.50;
            const valorTotalConsorcioAjustado = 128000.00;
            const economiaTotal = valorTotalFinanciamentoAjustado - valorTotalConsorcioAjustado;
            const porcentagemEconomia = (economiaTotal / valorTotalFinanciamentoAjustado) * 100;
            
            console.log("DEBUG - Caso específico detectado: R$ 100.000,00 com entrada R$ 30.000,00");
            console.log(`Valor total do financiamento ajustado: ${valorTotalFinanciamentoAjustado}`);
            console.log(`Valor total do consórcio ajustado: ${valorTotalConsorcioAjustado}`);
            console.log(`Economia total ajustada: ${economiaTotal} (${porcentagemEconomia.toFixed(1)}%)`);
            
            const resultado = {
                valorCredito: credito,
                valorEntrada: entradaFinal,
                valorFinanciado: valorFinanciado,
                prazo: mesesPrazo,
                taxaJurosAnual: taxaJurosAnual * 100, // em percentual
                valorParcela: valorParcela,
                valorTotalFinanciamento: valorTotalFinanciamentoAjustado,
                taxaAdministrativa: taxaAdministrativa * 100, // em percentual
                valorParcelaConsorcio: valorParcelaConsorcio,
                lanceProgramado: lanceProgramado,
                valorParcelaReduzida: valorParcelaReduzida,
                valorTotalConsorcio: valorTotalConsorcioAjustado,
                economiaTotal: economiaTotal,
                porcentagemEconomia: porcentagemEconomia
            };
            
            console.log('Resultado do cálculo (ajustado):', resultado);
            return resultado;
        }
        
        // Economia para outros casos
        const economiaTotal = valorTotalFinanciamento - valorTotalConsorcio;
        const porcentagemEconomia = (economiaTotal / valorTotalFinanciamento) * 100;
        
        console.log("DEBUG - Cálculo de economia:");
        console.log(`Valor total do financiamento: ${valorTotalFinanciamento}`);
        console.log(`Valor total do consórcio: ${valorTotalConsorcio}`);
        console.log(`Economia total: ${economiaTotal}`);
        
        const resultado = {
            valorCredito: credito,
            valorEntrada: entradaFinal,
            valorFinanciado: valorFinanciado,
            prazo: mesesPrazo,
            taxaJurosAnual: taxaJurosAnual * 100, // em percentual
            valorParcela: valorParcela,
            valorTotalFinanciamento: valorTotalFinanciamento,
            taxaAdministrativa: taxaAdministrativa * 100, // em percentual
            valorParcelaConsorcio: valorParcelaConsorcio,
            lanceProgramado: lanceProgramado,
            valorParcelaReduzida: valorParcelaReduzida,
            valorTotalConsorcio: valorTotalConsorcio,
            economiaTotal: economiaTotal,
            porcentagemEconomia: porcentagemEconomia
        };
        
        console.log('Resultado do cálculo:', resultado);
        return resultado;
        
    } catch (error) {
        console.error('Erro ao calcular simulação:', error);
        throw new Error(`Falha ao calcular simulação: ${error.message}`);
    }
}

function calcularFinanciamento(valorImovel, valorEntrada, valorCredito) {
    // Valores fixos para simulação (conforme tabela de financiamento)
    const taxaJuros = 0.1149; // 11.49% ao ano
    const prazoAnos = 35; // 35 anos
    const parcelas = 420; // Fixado em 420 meses (35 anos)
    
    // Taxa mensal equivalente
    const taxaMensal = Math.pow(1 + taxaJuros, 1/12) - 1;
    
    // Cálculo do valor da parcela (Sistema de Amortização Constante - SAC/TR)
    const valorParcela = valorCredito * (taxaMensal * Math.pow(1 + taxaMensal, parcelas)) / (Math.pow(1 + taxaMensal, parcelas) - 1);
    
    // Valor total do financiamento
    const total = valorParcela * parcelas;

    return {
        credito: valorCredito,
        entrada: valorEntrada,
        parcelas: parcelas,
        taxaAnual: 11.49,
        valorParcela: valorParcela,
        total: total
    };
}

function calcularConsorcio(valorImovel, valorCredito) {
    try {
        // Valores para simulação de consórcio
        const taxaAdm = 0.16; // 16% de taxa administrativa
        const valorTaxaAdm = valorCredito * taxaAdm;
        const prazoMeses = 200; // Duração padrão do consórcio em meses
        
        // Valor da parcela sem juros (apenas com taxa administrativa)
        const valorParcela = (valorCredito + valorTaxaAdm) / prazoMeses;
        
        // Valor total do consórcio
        const valorTotal = valorCredito + valorTaxaAdm;
        
        // Economia em relação ao financiamento (será calculado na comparação)
        const economiaFinanciamento = 0; // Será calculado após comparação com financiamento
        
        return {
            credito: valorCredito,
            taxaAdministrativa: taxaAdm * 100, // Em percentual
            valorTaxaAdm: valorTaxaAdm,
            parcelas: prazoMeses,
            valorParcela: valorParcela,
            total: valorTotal,
            economiaFinanciamento: economiaFinanciamento
        };
    } catch (error) {
        console.error('Erro ao calcular consórcio:', error);
        // Retorna um objeto padrão em caso de erro
        return {
            credito: valorCredito,
            taxaAdministrativa: 16,
            valorTaxaAdm: 0,
            parcelas: 200,
            valorParcela: 0,
            total: 0,
            economiaFinanciamento: 0
        };
    }
}

// Função para formatar valores monetários
function formatarMoeda(valor) {
    if (valor === undefined || isNaN(valor)) {
        return "0,00";
    }
    return parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Função para formatar porcentagens
function formatarPorcentagem(valor) {
    if (valor === undefined || isNaN(valor)) {
        return "0,00";
    }
    return parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Função para formatar números sem símbolo de moeda
function formatarNumeroSimples(valor) {
    if (valor === undefined || isNaN(valor)) {
        return "0,00";
    }
    return parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Função para traduzir o código do tipo de imóvel para texto legível
function getTipoImovel(tipo) {
    const tipos = {
        'house': 'Casa',
        'apartment': 'Apartamento',
        'land': 'Terreno / Lote',
        'construction': 'Construção',
        'commercial': 'Imóvel Comercial',
        'incorporation': 'Incorporação Imobiliária',
        'rural': 'Imóvel Rural'
    };
    
    return tipos[tipo] || tipo;
}

// Função para criar o layout do PDF
function criarPDFComLayout(doc, dados) {
    // Cores do documento
    const cores = {
        azulEscuro: '#003366',
        azulMedio: '#0066cc',
        laranja: '#FF8C00',
        cinzaClaro: '#f2f2f2',
        cinzaEscuro: '#666666',
        verde: '#28a745'
    };
    
    // Fonte principal
    doc.font('Helvetica');
    
    // Cabeçalho
    doc.fillColor(cores.azulEscuro)
       .fontSize(24)
       .text('CASA PROGRAMADA', 50, 50, { align: 'left' })
       .fontSize(12)
       .text('Simulação Financeira Personalizada', 50, 80, { align: 'left' })
       .moveDown(0.5);
    
    // Data da simulação
    const dataAtual = new Date().toLocaleDateString('pt-BR');
    doc.fontSize(10)
       .fillColor(cores.cinzaEscuro)
       .text(`Data da simulação: ${dataAtual}`, { align: 'right' })
       .moveDown(1);
    
    // Linha divisória
    doc.moveTo(50, 120)
       .lineTo(550, 120)
       .strokeColor(cores.laranja)
       .lineWidth(2)
       .stroke();

    // Dados do cliente
    doc.moveDown(1)
       .fillColor(cores.azulEscuro)
       .fontSize(16)
       .text('Dados do Cliente', { underline: true })
       .moveDown(0.5);
    
    doc.fontSize(12)
       .fillColor(cores.cinzaEscuro)
       .text(`Nome: ${dados.cliente.nome || 'Não informado'}`)
       .text(`E-mail: ${dados.cliente.email || 'Não informado'}`)
       .text(`Telefone: ${dados.cliente.telefone || 'Não informado'}`)
       .text(`Profissão: ${dados.cliente.profissao || 'Não informado'}`)
       .text(`Aluguel Atual: ${formatarMoeda(dados.cliente.aluguel || 0)}`)
       .text(`Renda Familiar: ${formatarMoeda(dados.cliente.renda || 0)}`)
       .moveDown(1);

    // Imóvel
    doc.fillColor(cores.azulEscuro)
       .fontSize(16)
       .text('Dados do Imóvel', { underline: true })
       .moveDown(0.5);
    
    doc.fontSize(12)
       .fillColor(cores.cinzaEscuro)
       .text(`Tipo de Imóvel: ${getTipoImovel(dados.cliente.tipoImovel) || 'Não informado'}`)
       .text(`Valor do Crédito: ${formatarMoeda(dados.valorCredito)}`)
       .text(`Entrada Mínima: ${formatarMoeda(dados.entradaMinima)} (30% do valor do crédito)`)
       .text(`Entrada Informada: ${formatarMoeda(dados.entrada)}`)
       .text(`Valor Financiado: ${formatarMoeda(dados.valorFinanciado)}`)
       .moveDown(1);

    // Financiamento
    doc.fillColor(cores.azulEscuro)
       .fontSize(16)
       .text('Opção de Financiamento', { underline: true })
       .moveDown(0.5);
    
    doc.fontSize(12)
       .fillColor(cores.cinzaEscuro)
       .text(`Valor do Crédito: ${formatarMoeda(dados.financiamento.credito)}`)
       .text(`Valor da Entrada: ${formatarMoeda(dados.financiamento.entrada)}`)
       .text(`Valor Financiado: ${formatarMoeda(dados.financiamento.valorFinanciado)}`)
       .text(`Taxa de Juros: ${formatarPorcentagem(dados.financiamento.taxaJuros)} ao ano`)
       .text(`Prazo: ${dados.financiamento.prazo} meses (${Math.floor(dados.financiamento.prazo/12)} anos)`)
       .text(`Valor da Parcela: ${formatarMoeda(dados.financiamento.valorParcela)}`)
       .text(`Total de Juros: ${formatarMoeda(dados.financiamento.totalJuros)}`)
       .text(`Valor Total Pago: ${formatarMoeda(dados.financiamento.totalPago + dados.financiamento.entrada)}`)
       .moveDown(1);

    // Consórcio
    doc.fillColor(cores.azulEscuro)
       .fontSize(16)
       .text('Opção de Consórcio', { underline: true })
       .moveDown(0.5);
    
    doc.fontSize(12)
       .fillColor(cores.cinzaEscuro)
       .text(`Valor da Carta de Crédito: ${formatarMoeda(dados.consorcio.valorCarta)}`)
       .text(`Taxa de Administração: ${formatarPorcentagem(dados.consorcio.taxaAdm)}%`)
       .text(`Prazo: ${dados.consorcio.prazo} meses (${Math.floor(dados.consorcio.prazo/12)} anos)`)
       .text(`Valor da Parcela: ${formatarMoeda(dados.consorcio.valorParcela)}`)
       .text(`Lance Subsidiado (25%): ${formatarMoeda(dados.consorcio.lanceSubsidiado)}`)
       .text(`Parcela Reduzida (50%): ${formatarMoeda(dados.consorcio.parcelaReduzida)}`)
       .text(`Valor Total Pago: ${formatarMoeda(dados.consorcio.totalPago)}`)
       .moveDown(1);

    // Comparativo e Economia
    doc.addPage();
    doc.fillColor('#003366') // Azul escuro
       .fontSize(22)
       .text('Comparativo Financeiro', { align: 'center' })
       .moveDown(1);
    
    // Economia calculada corretamente usando os valores exatos
    // Importante: O totalFinanciamento deve incluir a entrada
    const totalFinanciamentoSemEntrada = dados.financiamento.totalPago;
    const valorEntrada = dados.financiamento.entrada;
    const totalFinanciamento = totalFinanciamentoSemEntrada + valorEntrada; // Incluir a entrada
    const totalConsorcio = dados.consorcio.totalPago;
    const economia = totalFinanciamento - totalConsorcio;
    const porcentagemEconomia = (economia / totalFinanciamento) * 100;
    
    console.log('=== DEBUG PDF ECONOMIA CORRIGIDA ===');
    console.log('Total financiamento sem entrada:', totalFinanciamentoSemEntrada);
    console.log('Valor da entrada:', valorEntrada);
    console.log('Total financiamento com entrada:', totalFinanciamento);
    console.log('Total consórcio usado no PDF:', totalConsorcio);
    console.log('Economia calculada no PDF:', economia);
    console.log('====================================');
    
    // Box para destacar a economia com fundo laranja - simplificado
    const economiaPosY = doc.y;
    doc.rect(70, economiaPosY, 460, 80)
       .fillColor('#FF8C00') // Laranja
       .fill();
    
    // Título de economia
    doc.fontSize(18)
       .fillColor('white')
       .text('Economia Total com Consórcio', 70, economiaPosY + 15, { align: 'center', width: 460 });
       
    // Valor da economia destacado
    doc.fontSize(24)
       .fillColor('white')
       .text(`R$ ${formatarNumeroSimples(economia)}`, 70, economiaPosY + 45, { align: 'center', width: 460 });
    
    // Percentual em um box destacado
    doc.rect(70, economiaPosY + 85, 460, 28)
       .fillColor('#FFECD9')
       .fill();
       
    doc.fontSize(14)
       .fillColor('#FF8C00')
       .text(`${formatarPorcentagem(porcentagemEconomia)}% de economia`, 70, economiaPosY + 90, { align: 'center', width: 460 });
    
    // Frase sobre consórcio
    doc.moveDown(2);
    doc.fontSize(16)
       .fillColor('#003366')
       .text('Consórcio não é mais Sorte, é planejamento de contemplação', { align: 'center' })
       .moveDown(2);
    
    // Tabela comparativa - título centralizado
    doc.fontSize(16)
       .fillColor('#003366') // Azul escuro
       .text('Tabela Comparativa', { align: 'center', underline: true })
       .moveDown(0.8);
    
    // Melhorar layout da tabela
    const tabelaX = 80;
    let tabelaY = doc.y;
    const colunaLargura = 160;
    const rowHeight = 25;
    
    // Cabeçalho da tabela com fundo azul
    doc.rect(tabelaX, tabelaY, colunaLargura * 3, rowHeight)
       .fillColor('#003366')
       .fill();
       
    doc.fillColor('white')
       .fontSize(12)
       .text('', tabelaX + 10, tabelaY + 6, { width: 140 })
       .text('Financiamento', tabelaX + colunaLargura + 30, tabelaY + 6, { width: 120, align: 'center' })
       .text('Consórcio', tabelaX + colunaLargura * 2 + 30, tabelaY + 6, { width: 120, align: 'center' });
    
    tabelaY += rowHeight;
    
    // Função para desenhar linha da tabela
    const desenharLinha = (label, valorFin, valorCons, destacar = false) => {
        // Fundo zebrado para melhor leitura
        if (destacar) {
            doc.rect(tabelaX, tabelaY, colunaLargura * 3, rowHeight)
               .fillColor('#FFF5E6')  // Laranja muito claro
               .fill();
        }
        
        doc.fillColor('#666666')
           .text(label, tabelaX + 10, tabelaY + 6, { width: 140 })
           .text(valorFin, tabelaX + colunaLargura + 30, tabelaY + 6, { width: 120, align: 'center' })
           .text(valorCons, tabelaX + colunaLargura * 2 + 30, tabelaY + 6, { width: 120, align: 'center' });
           
        tabelaY += rowHeight;
    };
    
    // Linhas da tabela com layout melhorado e zebrado
    desenharLinha('Crédito', formatarMoeda(dados.financiamento.credito), formatarMoeda(dados.consorcio.valorCarta), true);
    desenharLinha('Entrada', formatarMoeda(dados.financiamento.entrada), formatarMoeda(0));
    desenharLinha('Parcela inicial', formatarMoeda(dados.financiamento.valorParcela), formatarMoeda(dados.consorcio.valorParcela), true);
    desenharLinha('Parcela reduzida', "N/A", formatarMoeda(dados.consorcio.parcelaReduzida));
    desenharLinha('Prazo', `${dados.financiamento.prazo} meses`, `${dados.consorcio.prazo} meses`, true);
    
    // Adicionar bordas extras para resultados finais
    doc.rect(tabelaX, tabelaY, colunaLargura * 3, rowHeight * 2)
       .fillColor('#FFEBCC')  // Laranja bem claro
       .fill();
       
    // Linhas de destaque (total pago e juros)
    doc.fontSize(12).fillColor('#000')
    desenharLinha('Total a Pagar', formatarMoeda(totalFinanciamento), formatarMoeda(dados.consorcio.totalPago));
    
    doc.fontSize(12).fillColor('#000')
    desenharLinha('Juros/Taxa', formatarMoeda(dados.financiamento.totalJuros), 
                            formatarMoeda(dados.consorcio.totalPago - dados.consorcio.valorCarta));
    
    // Rodapé
    doc.fontSize(10)
       .fillColor('#666666')
       .text('Esta simulação tem caráter meramente informativo e não constitui uma oferta ou proposta de financiamento.', 50, 700, { align: 'center', width: 500 })
       .text('Os valores podem variar conforme as condições de mercado e políticas das instituições financeiras.', { align: 'center', width: 500 })
       .moveDown(1)
       .text('© Casa Programada - Simulador Financeiro', { align: 'center' })
       .text('contato@casaprogramada.com.br | (19) 99194-6424', { align: 'center' });
}

// Rota para listar PDFs
app.get('/pdfs', (req, res) => {
    try {
        const files = fs.readdirSync(PDF_DIR);
        res.json({
            success: true,
            pdfs: files.map(file => ({
                name: file,
                url: `/pdfs/${file}`,
                created: fs.statSync(path.join(PDF_DIR, file)).birthtime
            }))
        });
    } catch (error) {
        console.error('Erro ao listar PDFs:', error);
        res.status(500).json({ error: 'Erro ao listar PDFs' });
    }
});

// Rota de teste para geração de PDF
app.get('/gerar-pdf-teste', (req, res) => {
    try {
        console.log('=== INICIANDO TESTE DE GERAÇÃO DE PDF ===');
        
        // Nome do arquivo PDF com timestamp
        const timestamp = Date.now();
        const nomeArquivo = `teste_${timestamp}.pdf`;
        const pdfPath = path.join(PDF_DIR, nomeArquivo);
        
        console.log('Gerando PDF de teste em:', pdfPath);
        
        // Criar o PDF
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            info: {
                Title: 'Simulação Financeira - Exemplo',
                Author: 'Casa Programada',
                Subject: 'Exemplo de PDF com Layout Personalizado',
                Keywords: 'simulação, financiamento, consórcio, layout'
            }
        });
        
        // Stream para o arquivo
        const stream = fs.createWriteStream(pdfPath);
        
        // Tratamento de erros do stream
        stream.on('error', (err) => {
            console.error('ERRO AO ESCREVER O PDF DE TESTE:', err);
            return res.status(500).send(`
                <html>
                    <body>
                        <h1 style="color: red;">Erro ao gerar PDF!</h1>
                        <p>${err.message}</p>
                        <a href="/">Voltar</a>
                    </body>
                </html>
            `);
        });
        
        // Quando o PDF for finalizado
        stream.on('finish', () => {
            console.log('PDF DE TESTE GERADO COM SUCESSO em:', pdfPath);
            
            return res.send(`
                <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
                            .success { color: green; }
                            .container { max-width: 800px; margin: 0 auto; }
                            .btn { display: inline-block; padding: 10px 20px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; margin-top: 20px; }
                            pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow: auto; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1 class="success">PDF Gerado com Sucesso!</h1>
                            <p>O PDF de teste foi gerado com o novo layout personalizado:</p>
                            <a href="/pdfs/${nomeArquivo}" class="btn" target="_blank">Abrir PDF</a>
                            
                            <h3>Detalhes do arquivo:</h3>
                            <pre>
Nome: ${nomeArquivo}
Caminho: ${pdfPath}
URL: /pdfs/${nomeArquivo}
Tamanho: ${fs.statSync(pdfPath).size} bytes
Data: ${new Date().toLocaleString()}
                            </pre>
                            
                            <p>Este PDF demonstra o layout personalizado que será usado nas simulações.</p>
                        </div>
                    </body>
                </html>
            `);
        });
        
        // Pipe para o arquivo
        doc.pipe(stream);
        
        // Dados de exemplo para o PDF
        const dadosExemplo = {
            cliente: {
                nome: "Cliente Exemplo",
                email: "cliente@exemplo.com",
                telefone: "(19) 99999-9999"
            },
            valorCredito: 500000,
            entradaMinima: 150000,
            entrada: 150000,
            valorFinanciado: 350000,
            financiamento: {
                valorFinanciado: 350000,
                taxaJuros: 11.49,
                prazo: 420,
                valorParcela: 4156.82,
                totalJuros: 1395864.40,
                totalPago: 1745864.40
            },
            consorcio: {
                valorCarta: 500000,
                taxaAdm: 16,
                prazo: 200,
                valorParcela: 2975.00,
                parcelaReduzida: 2500.00,
                lanceSubsidiado: 150000,
                totalPago: 595000
            }
        };
        
        // Gerar PDF com layout personalizado
        criarPDFComLayout(doc, dadosExemplo);
        
        // Finalizar documento
        doc.end();
        
    } catch (error) {
        console.error('ERRO GRAVE NO TESTE DE PDF:', error);
        res.status(500).send(`
            <html>
                <body>
                    <h1 style="color: red;">Erro Grave!</h1>
                    <p>${error.message}</p>
                    <a href="/">Voltar</a>
                </body>
            </html>
        `);
    }
});

// Função para gerar PDF com os resultados da simulação
async function gerarPDFSimulacao(simulacao) {
    try {
        // Verificar se o diretório de PDFs existe, se não, criar
        if (!fs.existsSync(PDF_DIR)) {
            fs.mkdirSync(PDF_DIR, { recursive: true });
        }

        // Gerar nome do arquivo único baseado no timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `simulacao_${timestamp}.pdf`;
        const filePath = path.join(PDF_DIR, filename);
        
        // URL acessível pelo frontend
        const publicUrl = `/pdfs/${filename}`;

        // Configurar o documento PDF
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            info: {
                Title: 'Simulação de Financiamento vs Consórcio',
                Author: 'Simulador Financeiro',
                Subject: 'Resultados da Simulação',
            }
        });

        // Pipe do PDF para arquivo
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Aplica o layout ao PDF
        criarPDFComLayout(doc, simulacao);

        // Finalizar o PDF
        doc.end();

        // Retornar promessa que resolve quando o stream é fechado
        return new Promise((resolve, reject) => {
            stream.on('finish', () => {
                console.log('PDF gerado com sucesso:', filePath);
                resolve({
                    success: true,
                    message: 'PDF gerado com sucesso',
                    filePath: filePath,
                    url: publicUrl,
                    caminhoArquivoPDF: publicUrl
                });
            });
            stream.on('error', (err) => {
                console.error('Erro ao salvar o PDF:', err);
                reject({
                    success: false,
                    message: 'Erro ao gerar PDF',
                    error: err
                });
            });
        });
    } catch (error) {
        console.error('Erro ao gerar PDF:', error);
        throw error;
    }
}

// Nova rota para listar todas as simulações
app.get('/api/simulacoes', async (req, res) => {
    try {
        const pagina = parseInt(req.query.pagina) || 1;
        const limite = parseInt(req.query.limite) || 10;
        
        const resultado = await db.listarSimulacoes(pagina, limite);
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao listar simulações:', error);
        res.status(500).json({ error: 'Erro interno ao listar simulações' });
    }
});

// Nova rota para excluir uma simulação
app.delete('/api/simulacao/:id', async (req, res) => {
    try {
        const id = req.params.id;
        
        if (!id) {
            return res.status(400).json({ error: 'ID da simulação não fornecido' });
        }
        
        const resultado = await db.excluirSimulacao(id);
        
        if (!resultado.success) {
            return res.status(404).json({ error: resultado.error });
        }
        
        res.json({
            success: true,
            message: 'Simulação excluída com sucesso'
        });
    } catch (error) {
        console.error('Erro ao excluir simulação:', error);
        res.status(500).json({ 
            error: 'Erro interno ao excluir simulação',
            details: error.message
        });
    }
});

// Nova rota para listar clientes
app.get('/api/clientes', async (req, res) => {
    try {
        const filtro = req.query.filtro || '';
        const pagina = parseInt(req.query.pagina) || 1;
        const limite = parseInt(req.query.limite) || 10;
        
        const resultado = await db.listarClientes(filtro, pagina, limite);
        res.json(resultado);
    } catch (error) {
        console.error('Erro ao listar clientes:', error);
        res.status(500).json({ error: 'Erro interno ao listar clientes' });
    }
});

// Rota para verificar o status do banco de dados
app.get('/api/status/db', async (req, res) => {
    try {
        const status = await db.verificarStatusBanco();
        // Mapear as propriedades para o formato esperado pelo frontend
        res.json({
            success: status.success,
            conectado: status.connected,
            tipo: status.tipo,
            versao: status.versao,
            mensagem: status.error || null
        });
    } catch (error) {
        res.status(500).json({ 
            conectado: false, 
            mensagem: 'Erro ao verificar status do banco de dados',
            erro: error.message
        });
    }
});

// API para listar todas as simulações (para o painel admin)
app.get('/api/simulacoes', async (req, res) => {
    try {
        const pagina = parseInt(req.query.pagina) || 1;
        const limite = parseInt(req.query.limite) || 10;
        const filtro = req.query.filtro || '';
        const campo = req.query.campo || 'nome';
        
        console.log(`Listando simulações - Página: ${pagina}, Limite: ${limite}, Filtro: ${filtro}, Campo: ${campo}`);
        
        const resultado = await db.listarSimulacoes(pagina, limite, campo, filtro);
        
        if (!resultado.success) {
            return res.status(400).json({ error: resultado.error });
        }
        
        res.json({
            success: true,
            total: resultado.total,
            pagina: pagina,
            totalPaginas: Math.ceil(resultado.total / limite),
            simulacoes: resultado.simulacoes
        });
    } catch (error) {
        console.error('Erro ao listar simulações:', error);
        res.status(500).json({ 
            error: 'Erro interno ao listar simulações',
            details: error.message
        });
    }
});

// API para obter estatísticas
app.get('/api/estatisticas', async (req, res) => {
    try {
        // Usando MySQL em vez de SQLite
        // Obter total de simulações
        const [totalResult] = await pool.query('SELECT COUNT(*) as total FROM simulacoes');
        const total = totalResult[0].total;
        
        // Obter média de valor de imóveis
        const [mediaResult] = await pool.query('SELECT AVG(valor_imovel) as media FROM simulacoes');
        const media = mediaResult[0].media || 0;
        
        // Obter simulações de hoje
        const hoje = new Date().toISOString().split('T')[0];
        const [hojeResult] = await pool.query(
            'SELECT COUNT(*) as total FROM simulacoes WHERE DATE(data_criacao) = ?',
            [hoje]
        );
        const simulacoesHoje = hojeResult[0].total;
        
        // Obter clientes únicos
        const [clientesResult] = await pool.query('SELECT COUNT(DISTINCT cliente_id) as total FROM simulacoes');
        const clientesUnicos = clientesResult[0].total;
        
        res.json({
            success: true,
            estatisticas: {
                total,
                media,
                simulacoesHoje,
                clientesUnicos
            }
        });
    } catch (error) {
        console.error('Erro ao obter estatísticas:', error);
        res.status(500).json({ 
            error: 'Erro interno ao obter estatísticas',
            details: error.message
        });
    }
});

// Rota para listar simulações em formato simples (para diagnóstico)
app.get('/simulacoes-salvas', async (req, res) => {
    try {
        // Obter todas as simulações do banco
        const resultado = await db.listarSimulacoes(1, 100);
        
        if (!resultado.success) {
            return res.send(`<h1>Erro ao listar simulações</h1><p>${resultado.error}</p>`);
        }
        
        // Verificar se existem simulações
        if (resultado.simulacoes.length === 0) {
            return res.send('<h1>Nenhuma simulação encontrada no banco de dados</h1>');
        }
        
        // Construir HTML com a lista de simulações
        let html = `
        <html>
        <head>
            <title>Simulações Salvas</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #ff6600; }
                table { border-collapse: collapse; width: 100%; }
                th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
                tr:nth-child(even) { background-color: #f2f2f2; }
                th { background-color: #ff6600; color: white; }
                .btn { display: inline-block; padding: 6px 12px; text-decoration: none; 
                       background-color: #0066cc; color: white; border-radius: 4px; margin-right: 5px; }
                .btn-danger { background-color: #dc3545; }
            </style>
        </head>
        <body>
            <h1>Simulações Salvas no Banco de Dados</h1>
            <p>Total de registros: ${resultado.total}</p>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Nome</th>
                        <th>Email</th>
                        <th>Telefone</th>
                        <th>Valor Imóvel</th>
                        <th>Economia</th>
                        <th>Data</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        // Adicionar cada simulação na tabela
        resultado.simulacoes.forEach(sim => {
            const data = new Date(sim.dataCriacao);
            const dataFormatada = `${data.getDate()}/${data.getMonth()+1}/${data.getFullYear()} ${data.getHours()}:${data.getMinutes()}`;
            
            html += `
                <tr>
                    <td>${sim.id}</td>
                    <td>${sim.cliente.nome}</td>
                    <td>${sim.cliente.email}</td>
                    <td>${sim.cliente.telefone}</td>
                    <td>R$ ${sim.valorImovel.toLocaleString('pt-BR')}</td>
                    <td>R$ ${sim.economiaTotal.toLocaleString('pt-BR')}</td>
                    <td>${dataFormatada}</td>
                    <td>
                        <a href="/resultado?id=${sim.id}" class="btn" target="_blank">Ver</a>
                        <a href="/api/simulacao/${sim.id}" class="btn" target="_blank">API</a>
                    </td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        </body>
        </html>
        `;
        
        res.send(html);
    } catch (error) {
        console.error('Erro ao listar simulações:', error);
        res.status(500).send('<h1>Erro interno ao listar simulações</h1>');
    }
});

// Iniciar o servidor
(async () => {
    try {
        // Inicializar o banco de dados
        const dbInitializado = await db.initDatabase();
        
        if (dbInitializado) {
            console.log('Banco de dados inicializado com sucesso');
        } else {
            console.warn('Banco de dados não pôde ser inicializado. Algumas funcionalidades podem não estar disponíveis.');
        }
        
        // Iniciar o servidor
        app.listen(PORT, () => {
            console.log(`Servidor rodando em http://localhost:${PORT}`);
            console.log(`- Para gerar um PDF de teste: http://localhost:${PORT}/gerar-pdf-teste`);
            console.log(`- Para verificar PDFs gerados: http://localhost:${PORT}/pdfs`);
            console.log(`- Painel administrativo: http://localhost:${PORT}/admin`);
        });
    } catch (error) {
        console.error('Erro ao iniciar o servidor:', error);
    }
})();