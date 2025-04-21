<?php
// Configurar headers para evitar cache
header('Content-Type: application/javascript');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// Gerar uma marca de tempo única
$timestamp = date('YmdHis');
?>

// Configurações geradas dinamicamente pelo servidor em <?php echo date('Y-m-d H:i:s'); ?>
// Timestamp: <?php echo $timestamp; ?>

// Definições globais para cálculos
const CONFIG_FINANCIAMENTO = {
    PRAZO_MESES: 420, // 35 anos = 420 meses (FIXADO)
    TAXA_JUROS_ANUAL: 0.1149, // 11.49% ao ano (FIXADO)
    TEXTO_PRAZO: "420 meses (35 anos)"
};

const CONFIG_CONSORCIO = {
    PRAZO_MESES: 240, // 20 anos = 240 meses (FIXADO) 
    TAXA_ADMIN: 0.28, // 28% taxa administrativa (FIXADO)
    TEXTO_PRAZO: "240 meses (20 anos)"
};

// Versão dos scripts para verificar se estão atualizados
const VERSAO_SCRIPTS = "1.2-<?php echo $timestamp; ?>";

console.log("Configurações globais carregadas via PHP - Versão:", VERSAO_SCRIPTS);
console.log("Prazo financiamento:", CONFIG_FINANCIAMENTO.PRAZO_MESES, "meses");
console.log("Prazo consórcio:", CONFIG_CONSORCIO.PRAZO_MESES, "meses"); 