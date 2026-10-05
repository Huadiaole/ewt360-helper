using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

/// <summary>
/// 升学E网通助手 · 启动器（用 .NET Framework 自带的 csc.exe 编译，约 20KB）
///
/// 为什么需要它：Chromium 在 main.js 执行之前就已经决定了「沙箱」和「配置目录」，
/// 从 JS 里改已经来不及。实测（2x2 对照）证明必须同时满足：
///   ① --no-sandbox           受限环境下 Chromium 沙箱初始化会被拒
///   ② --user-data-dir=可写目录 配置目录不能落在受限范围之外
/// 这两条只能写在命令行上，所以用这个小 exe 来带参数启动 app.exe。
/// 顺带把 NODE_OPTIONS 清掉（本机环境里带 --use-system-ca，Electron 会直接退出）。
/// </summary>
internal static class Launcher
{
    [STAThread]
    private static void Main(string[] args)
    {
        string dir;
        try { dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location); }
        catch { dir = Environment.CurrentDirectory; }

        string app = Path.Combine(dir, "app.exe");
        if (!File.Exists(app)) app = Path.Combine(dir, "升学E网通助手.exe");

        if (!File.Exists(app))
        {
            MessageBox.Show(
                "找不到主程序 app.exe，请确认它和本文件在同一个目录里。\r\n\r\n目录：" + dir,
                "升学E网通助手", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // 配置目录放在程序旁边：既保证可写，又避开受限范围
        string userData = Path.Combine(dir, "userdata");
        try { Directory.CreateDirectory(userData); } catch { }

        StringBuilder sb = new StringBuilder();
        sb.Append("--no-sandbox --disable-gpu-sandbox ");
        sb.Append("--user-data-dir=\"").Append(userData).Append("\" ");
        sb.Append("--autoplay-policy=no-user-gesture-required ");
        for (int i = 0; i < args.Length; i++)
        {
            sb.Append('"').Append(args[i].Replace("\"", "\\\"")).Append("\" ");
        }

        ProcessStartInfo psi = new ProcessStartInfo(app);
        psi.Arguments = sb.ToString();
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        try { psi.EnvironmentVariables.Remove("NODE_OPTIONS"); }
        catch { }

        try
        {
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "启动失败：" + ex.Message + "\r\n\r\n可以把这句话发给鲸鱼娘。",
                "升学E网通助手", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
